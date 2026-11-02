import type { FrameContext, NormalizedEvent, ObservationLimitation } from "@adtripwire/shared";
import { hostnameOf } from "@adtripwire/privacy";
import { registrableDomain } from "@adtripwire/indicators";
import { buildEvent, type Phase, type RequestDetailsLike } from "@adtripwire/sensor-firefox";
import type { FrameAncestry, FrameTreeCache } from "./frame-tree.js";

/**
 * Chromium MV3 webRequest details. No frameAncestors, documentUrl, originUrl, thirdParty,
 * urlClassification or incognito; `initiator` is an origin string ("https://a.example" or
 * "null" for opaque origins).
 */
export interface ChromiumRequestDetails {
  requestId: string;
  url: string;
  method?: string | undefined;
  type: string;
  tabId: number;
  frameId: number;
  parentFrameId: number;
  timeStamp: number;
  initiator?: string | undefined;
  documentId?: string | undefined;
  parentDocumentId?: string | undefined;
  frameType?: string | undefined;
  documentLifecycle?: string | undefined;
  statusCode?: number | undefined;
  redirectUrl?: string | undefined;
  fromCache?: boolean | undefined;
  ip?: string | undefined;
  responseHeaders?: Array<{ name: string; value?: string | undefined }> | undefined;
  error?: string;
}

/** Read-only view of the frame tree the builder needs (FrameTreeCache satisfies it). */
export type FrameTreeView = Pick<FrameTreeCache, "ancestry" | "chainFrom" | "hostnameOf">;

/** Registrable domain, falling back to the hostname for IPs, single labels and suffix-only hosts. */
export function siteOf(hostname: string): string {
  return registrableDomain(hostname) ?? hostname;
}

/**
 * Builds a NormalizedEvent from Chromium webRequest details, identical in shape to the
 * Firefox sensor's. Returns null when the URL cannot be sanitized.
 *
 * Reuses the Firefox builder for phase/status mapping, URL sanitization, initiator origin,
 * Content-Length parsing and resource-type mapping (`webbundle` → `other`), then replaces the
 * frame context with one reconstructed from the webNavigation frame tree.
 */
export function buildChromiumEvent(
  phase: Phase,
  details: ChromiumRequestDetails,
  frameTree: FrameTreeView | undefined,
  topHostnameHint?: string,
): NormalizedEvent | null {
  const base: RequestDetailsLike = {
    requestId: details.requestId,
    url: details.url,
    type: details.type,
    tabId: details.tabId,
    frameId: details.frameId,
    parentFrameId: details.parentFrameId,
    timeStamp: details.timeStamp,
  };
  if (details.method !== undefined) base.method = details.method;
  // originOf() rejects the opaque "null" initiator (no hostname), which is what we want.
  if (details.initiator !== undefined) base.originUrl = details.initiator;
  if (details.statusCode !== undefined) base.statusCode = details.statusCode;
  if (details.redirectUrl !== undefined) base.redirectUrl = details.redirectUrl;
  if (details.fromCache !== undefined) base.fromCache = details.fromCache;
  if (details.responseHeaders !== undefined) {
    base.responseHeaders = details.responseHeaders.map((h) =>
      h.value === undefined ? { name: h.name } : { name: h.name, value: h.value },
    );
  }
  if (details.error !== undefined) base.error = details.error;

  const ev = buildEvent("chromium", phase, base);
  if (!ev) return null;

  // The Firefox builder adds frame_ancestry_unavailable and url_classification_unavailable;
  // recompute the frame-related limitations here.
  const limitations: ObservationLimitation[] = ev.observationLimitations.filter(
    (l) => l !== "frame_ancestry_unavailable" && l !== "url_classification_unavailable",
  );
  ev.frameContext = buildChromiumFrameContext(
    details,
    ev.destination.hostname,
    frameTree,
    topHostnameHint,
    limitations,
  );
  limitations.push("url_classification_unavailable");
  // Chromium MV3 has no filterResponseData: no response body is ever readable.
  limitations.push("no_response_body_access");
  ev.observationLimitations = limitations;
  return ev;
}

function initiatorHost(details: ChromiumRequestDetails): string | undefined {
  if (!details.initiator || details.initiator === "null") return undefined;
  return hostnameOf(details.initiator) ?? undefined;
}

export function buildChromiumFrameContext(
  d: ChromiumRequestDetails,
  destinationHost: string,
  tree: FrameTreeView | undefined,
  topHostnameHint: string | undefined,
  limitations: ObservationLimitation[],
): FrameContext {
  const ctx: FrameContext = {
    frameId: d.frameId,
    parentFrameId: d.parentFrameId,
    ancestorHostnames: [],
    depth: d.frameId === 0 ? 0 : 1,
  };

  if (d.type === "main_frame") {
    // New top-level document: the tree's frame 0 still holds the previous document.
    ctx.depth = 0;
    ctx.ancestorFrameIds = [];
    ctx.topHostname = destinationHost;
    ctx.thirdParty = false;
    return ctx;
  }

  const tabKnown = d.tabId >= 0 && tree !== undefined;
  let anc: FrameAncestry | undefined;
  if (tabKnown) {
    if (d.type === "sub_frame") {
      // The navigating frame itself is not committed yet; its parent is.
      anc = d.parentFrameId >= 0 ? tree.chainFrom(d.tabId, d.parentFrameId) : undefined;
    } else {
      anc = tree.ancestry(d.tabId, d.frameId);
    }
  }
  if (!anc && d.frameId === 0 && d.type !== "sub_frame") {
    // The top-level frame has no ancestors by definition, whether or not the tree knows the tab.
    anc = { frameIds: [], hostnames: [], complete: true };
  }

  if (anc && anc.complete) {
    ctx.ancestorHostnames = anc.hostnames;
    ctx.ancestorFrameIds = anc.frameIds;
    ctx.depth = anc.frameIds.length;
  } else if (anc) {
    // Partial chain: keep the hostnames for display but withhold ancestorFrameIds so lineage
    // correlation treats ancestry as unknown rather than as a definite "unrelated".
    ctx.ancestorHostnames = anc.hostnames;
    ctx.depth = Math.max(1, anc.frameIds.length);
    limitations.push("frame_ancestry_unavailable");
  } else {
    limitations.push("frame_ancestry_unavailable");
  }

  // Document that issued the request: for sub_frame, the parent document; otherwise the
  // frame's own document. The initiator is preferred for subresources because a request can
  // arrive before the frame's commit reaches the tree.
  const init = initiatorHost(d);
  let docHost: string | undefined;
  if (d.type === "sub_frame") {
    docHost =
      (tabKnown && d.parentFrameId >= 0 ? tree.hostnameOf(d.tabId, d.parentFrameId) : undefined) ??
      init;
  } else {
    docHost = init ?? (tabKnown ? tree.hostnameOf(d.tabId, d.frameId) : undefined);
  }
  if (docHost) ctx.documentHostname = docHost;

  let top: string | undefined;
  if (anc && anc.complete && anc.hostnames.length > 0) {
    top = anc.hostnames[anc.hostnames.length - 1];
  } else if (d.frameId === 0 && d.type !== "sub_frame" && docHost) {
    top = docHost;
  } else if (tabKnown) {
    top = tree.hostnameOf(d.tabId, 0) ?? topHostnameHint;
  } else {
    top = topHostnameHint;
  }
  if (top) ctx.topHostname = top;

  // Third-party inference mirrors Firefox's flag semantics (request URL or any document in
  // its window hierarchy is cross-site to the top document). Omitted unless both the
  // issuing document's host and the top host are known.
  if (top && docHost) {
    const topSite = siteOf(top);
    const hosts = [destinationHost, docHost, ...ctx.ancestorHostnames];
    ctx.thirdParty = hosts.some((h) => siteOf(h) !== topSite);
  }
  return ctx;
}
