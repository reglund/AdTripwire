import type { NormalizedEvent, PageSignal, PageSignalKind } from "@adtripwire/shared";
import { newId } from "@adtripwire/shared";
import { hostnameOf } from "@adtripwire/privacy";
import { normalizeHostname } from "@adtripwire/indicators";

const KINDS = new Set<PageSignalKind>([
  "postmessage_sdk_ready",
  "postmessage_wildcard_like",
  "hidden_iframe_inserted",
  "script_inserted",
  "beacon_image_inserted",
]);

/** Rate limits so a hostile frame cannot flood the engine or starve sibling frames. */
const PER_TAB_MAX_PER_MINUTE = 120;
const PER_FRAME_MAX_PER_MINUTE = 40;
const buckets = new Map<string, { windowStart: number; count: number }>();

function allow(key: string, limit: number, now: number): boolean {
  const b = buckets.get(key);
  if (!b || now - b.windowStart > 60_000) {
    buckets.set(key, { windowStart: now, count: 1 });
    if (buckets.size > 2000) buckets.delete(buckets.keys().next().value as string);
    return true;
  }
  b.count++;
  return b.count <= limit;
}

export function pageSignalAllowed(tabId: number, now: number, frameId = -1): boolean {
  const tabOk = allow(`t:${tabId}`, PER_TAB_MAX_PER_MINUTE, now);
  const frameOk =
    frameId >= 0 ? allow(`f:${tabId}:${frameId}`, PER_FRAME_MAX_PER_MINUTE, now) : true;
  return tabOk && frameOk;
}

/**
 * Validates a raw content-script message and turns it into a NormalizedEvent. Returns null
 * for anything not matching the strict shape. `sender` facts (tab, frame, url) come from the
 * browser, not from the page, and are the only source of frame context.
 */
export function buildPageSignalEvent(
  raw: unknown,
  sender: { tabId: number; frameId: number; frameUrl?: string; incognito?: boolean },
  now: number,
  ancestry?: { frameIds: number[]; hostnames: string[]; truncated?: boolean },
): NormalizedEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== "page_signal") return null;
  if (typeof r.kind !== "string" || !KINDS.has(r.kind as PageSignalKind)) return null;
  if (sender.frameId <= 0) return null; // never from top-level documents
  if (sender.tabId < 0) return null;

  const signal: PageSignal = { kind: r.kind as PageSignalKind };
  if (r.targetHostname !== undefined) {
    if (typeof r.targetHostname !== "string" || r.targetHostname.length > 253) return null;
    const h = normalizeHostname(r.targetHostname);
    if (!h) return null;
    signal.targetHostname = h;
  }
  if (r.crossOrigin !== undefined) {
    if (typeof r.crossOrigin !== "boolean") return null;
    signal.crossOrigin = r.crossOrigin;
  }
  // Insertion time from the content script's clock: used as the event timestamp so the
  // signal orders before the requests it caused. Clamped to [now - 60 s, now].
  let timestamp = now;
  if (r.insertedAt !== undefined) {
    if (typeof r.insertedAt !== "number" || !Number.isFinite(r.insertedAt)) return null;
    timestamp = Math.min(now, Math.max(now - 60_000, Math.round(r.insertedAt)));
  }
  if (r.msSinceLoad !== undefined) {
    if (typeof r.msSinceLoad !== "number" || !Number.isFinite(r.msSinceLoad) || r.msSinceLoad < 0)
      return null;
    signal.msSinceLoad = Math.min(Math.round(r.msSinceLoad), 86_400_000);
  }

  const frameHost = sender.frameUrl ? hostnameOf(sender.frameUrl) : null;
  // Subject is the frame's own document (what the rules key on); the inserted element's host
  // travels in pageSignal.targetHostname.
  const ev: NormalizedEvent = {
    eventId: newId(),
    timestamp,
    browser: "firefox",
    sensor: "page",
    eventType: "page_signal",
    tabId: sender.tabId,
    destination: {
      scheme: "https",
      hostname: frameHost ?? "unknown.invalid",
      pathPattern: "/",
      queryParamNames: [],
      redacted: true,
    },
    frameContext: {
      frameId: sender.frameId,
      parentFrameId: ancestry && ancestry.frameIds.length > 0 ? ancestry.frameIds[0]! : -1,
      ancestorHostnames: ancestry ? ancestry.hostnames : [],
      depth: ancestry ? ancestry.frameIds.length : 1,
      ...(ancestry ? { ancestorFrameIds: ancestry.frameIds } : {}),
      ...(frameHost ? { documentHostname: frameHost } : {}),
      ...(ancestry && ancestry.hostnames.length > 0
        ? { topHostname: ancestry.hostnames[ancestry.hostnames.length - 1]! }
        : {}),
      thirdParty: true,
    },
    requestStatus: "unknown",
    pageSignal: signal,
    matchedIndicators: [],
    matchedRules: [],
    evidenceQuality: "direct",
    observationLimitations: ancestry
      ? ancestry.truncated
        ? ["frame_ancestry_unavailable"]
        : []
      : ["frame_ancestry_unavailable"],
  };
  return ev;
}
