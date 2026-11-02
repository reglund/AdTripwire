import type {
  BrowserName,
  FrameContext,
  NormalizedEvent,
  ObservationLimitation,
  ResourceType,
  UrlClassification,
  UrlClassificationFlag,
} from "@adtripwire/shared";
import { newId } from "@adtripwire/shared";
import { hostnameOf, originOf, sanitizeUrl } from "@adtripwire/privacy";

/** Subset of webRequest details fields we read. Firefox-only fields are optional. */
export interface RequestDetailsLike {
  requestId: string;
  url: string;
  method?: string;
  type: string;
  tabId: number;
  frameId: number;
  parentFrameId: number;
  timeStamp: number;
  originUrl?: string;
  documentUrl?: string;
  frameAncestors?: Array<{ url: string; frameId: number }>;
  thirdParty?: boolean;
  urlClassification?: { firstParty: string[]; thirdParty: string[] };
  incognito?: boolean;
  statusCode?: number;
  redirectUrl?: string;
  fromCache?: boolean;
  responseHeaders?: Array<{ name: string; value?: string }>;
  error?: string;
}

const KNOWN_FLAGS = new Set<string>([
  "fingerprinting",
  "fingerprinting_content",
  "cryptomining",
  "cryptomining_content",
  "tracking",
  "tracking_ad",
  "tracking_analytics",
  "tracking_social",
  "tracking_content",
  "emailtracking",
  "emailtracking_content",
  "any_basic_tracking",
  "any_strict_tracking",
  "any_social_tracking",
]);

function toFlags(list: string[] | undefined): UrlClassificationFlag[] {
  if (!list) return [];
  return list.filter((f): f is UrlClassificationFlag => KNOWN_FLAGS.has(f));
}

export function buildFrameContext(
  d: RequestDetailsLike,
  limitations: ObservationLimitation[],
): FrameContext {
  const ancestors = d.frameAncestors;
  const ancestorHostnames: string[] = [];
  if (ancestors) {
    for (const a of ancestors) {
      const h = hostnameOf(a.url);
      if (h) ancestorHostnames.push(h);
    }
  } else {
    limitations.push("frame_ancestry_unavailable");
  }
  const ctx: FrameContext = {
    frameId: d.frameId,
    parentFrameId: d.parentFrameId,
    ancestorHostnames,
    depth: ancestors ? ancestors.length : d.frameId === 0 ? 0 : 1,
  };
  const docHost = d.documentUrl ? hostnameOf(d.documentUrl) : null;
  if (docHost) ctx.documentHostname = docHost;
  const top =
    ancestorHostnames.length > 0 ? ancestorHostnames[ancestorHostnames.length - 1] : docHost;
  if (top) ctx.topHostname = top;
  if (typeof d.thirdParty === "boolean") ctx.thirdParty = d.thirdParty;
  if (d.urlClassification) {
    const uc: UrlClassification = {
      firstParty: toFlags(d.urlClassification.firstParty),
      thirdParty: toFlags(d.urlClassification.thirdParty),
    };
    ctx.urlClassification = uc;
  } else {
    limitations.push("url_classification_unavailable");
  }
  return ctx;
}

const RESOURCE_TYPES = new Set<string>([
  "beacon",
  "csp_report",
  "font",
  "image",
  "imageset",
  "json",
  "main_frame",
  "media",
  "object",
  "object_subrequest",
  "ping",
  "script",
  "speculative",
  "stylesheet",
  "sub_frame",
  "web_manifest",
  "websocket",
  "xml_dtd",
  "xmlhttprequest",
  "xslt",
  "other",
]);

export function toResourceType(t: string): ResourceType {
  return (RESOURCE_TYPES.has(t) ? t : "other") as ResourceType;
}

export function headerValue(
  headers: RequestDetailsLike["responseHeaders"],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const h of headers) if (h.name.toLowerCase() === lower) return h.value;
  return undefined;
}

export type Phase = "started" | "redirected" | "completed" | "error";

/**
 * Builds a NormalizedEvent from webRequest details. Returns null if the URL cannot be
 * sanitized (we never record what we cannot sanitize).
 */
export function buildEvent(
  browserName: BrowserName,
  phase: Phase,
  d: RequestDetailsLike,
): NormalizedEvent | null {
  const destination = sanitizeUrl(d.url);
  if (!destination) return null;
  const limitations: ObservationLimitation[] = [];
  const frameContext = buildFrameContext(d, limitations);

  const ev: NormalizedEvent = {
    eventId: newId(),
    timestamp: d.timeStamp,
    browser: browserName,
    sensor: "webrequest",
    eventType:
      phase === "started"
        ? "request_started"
        : phase === "redirected"
          ? "request_redirected"
          : phase === "completed"
            ? "request_completed"
            : "request_error",
    requestId: d.requestId,
    destination,
    resourceType: toResourceType(d.type),
    frameContext,
    requestStatus:
      phase === "started"
        ? "started"
        : phase === "redirected"
          ? "redirected"
          : phase === "completed"
            ? "completed"
            : "error",
    matchedIndicators: [],
    matchedRules: [],
    evidenceQuality: "direct",
    observationLimitations: limitations,
  };
  if (d.tabId >= 0) ev.tabId = d.tabId;
  if (d.method) ev.method = d.method;
  const origin = d.originUrl ? originOf(d.originUrl) : null;
  if (origin) ev.initiatorOrigin = origin;
  if (phase === "redirected" && d.redirectUrl) {
    const rh = hostnameOf(d.redirectUrl);
    if (rh) ev.redirectHostname = rh;
  }
  if (phase === "completed") {
    if (typeof d.statusCode === "number") ev.statusCode = d.statusCode;
    if (d.fromCache) {
      ev.fromCache = true;
      limitations.push("from_cache");
    }
    const cl = headerValue(d.responseHeaders, "content-length");
    if (cl !== undefined && /^\d{1,15}$/.test(cl.trim())) {
      ev.responseSizeIfObservable = Number(cl.trim());
    } else {
      limitations.push("response_size_unknown");
    }
  }
  return ev;
}
