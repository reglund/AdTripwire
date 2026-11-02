import {
  fnv1a,
  newId,
  type Confidence,
  type Detection,
  type DetectionReference,
  type EvidenceItem,
  type IndicatorMatch,
  type NormalizedEvent,
  type ObservationLimitation,
  type RuleDefinition,
  type SensorCapability,
  type Severity,
} from "@adtripwire/shared";
import type { RuleContext } from "./types.js";
import { registrableDomain, publicSuffix, normalizeHostname } from "@adtripwire/indicators";

export const RULE_VERSION = "1.0.0";

export const SEVERITY_RANK: Record<Severity, number> = {
  informational: 0,
  suspicious: 1,
  elevated: 2,
  high_priority: 3,
};

export const ALL_CAPABILITIES: readonly SensorCapability[] = [
  "request_metadata",
  "redirect_chain",
  "frame_ancestry",
  "third_party_flag",
  "url_classification",
  "response_headers",
  "response_body_inspection",
  "response_size",
  "page_signals",
];

const LIMITATION_TEXT: Record<ObservationLimitation, string> = {
  no_response_body_access: "The response body could not be inspected for this request.",
  response_body_truncated: "Only a prefix of the response body was analysed.",
  response_body_unsupported_encoding:
    "The response body encoding could not be decoded for analysis.",
  frame_ancestry_unavailable: "The frame ancestry for this request was not available.",
  url_classification_unavailable:
    "Firefox tracking classification was not available for this request.",
  response_size_unknown: "The response size was not observable.",
  from_cache:
    "The response was served from cache, so size and timing may not reflect a fresh server decision.",
  incognito_excluded: "Private-browsing activity is excluded from observation.",
  sensor_restarted_during_request:
    "The sensor restarted during this request; earlier stages may be missing.",
  page_sensor_disabled:
    "The optional page sensor was disabled, so in-page signals (hidden frame insertion, SDK messages) were not observed.",
  response_body_skipped_budget:
    "The response body was not inspected because too many inspections were already in progress (memory budget).",
};

const CAPABILITY_TEXT: Record<SensorCapability, string> = {
  page_signals:
    "In-page signals from sub-frames (hidden iframe insertion, SDK messages) are not observed because the opt-in page sensor is off.",
  request_metadata: "Basic request metadata is not available from this browser sensor.",
  redirect_chain: "Redirect chains are not visible to this browser sensor.",
  frame_ancestry:
    "Frame ancestry (which frames embed which) is not visible to this browser sensor.",
  third_party_flag: "Third-party context flags are not available from this browser sensor.",
  url_classification:
    "Firefox tracking-protection classification is not available from this browser sensor.",
  response_headers: "Response headers are not visible to this browser sensor.",
  response_body_inspection: "Response bodies cannot be inspected by this browser sensor.",
  response_size: "Response sizes are not observable by this browser sensor.",
};

export const BASELINE_MISSING_VISIBILITY =
  "What code actually executed inside the page, and its effect on the device, is not observed; only network metadata and, where enabled, bounded analysis of selected response text are available.";

export function missingVisibilityFor(
  events: readonly NormalizedEvent[],
  capabilities: readonly SensorCapability[],
  extra: readonly ObservationLimitation[] = [],
): string[] {
  const out = new Set<string>();
  for (const e of events) for (const l of e.observationLimitations) out.add(LIMITATION_TEXT[l]);
  for (const l of extra) out.add(LIMITATION_TEXT[l]);
  for (const c of ALL_CAPABILITIES) if (!capabilities.includes(c)) out.add(CAPABILITY_TEXT[c]);
  out.add(BASELINE_MISSING_VISIBILITY);
  return [...out];
}

export const DEFAULT_ACTIONS = [
  "Review the listed events and the cited research before drawing conclusions.",
  "If you have reason to believe you are personally targeted, seek help from a digital-security helpline (for example Access Now's Digital Security Helpline) rather than acting on this alert alone.",
];

/** "/getAd" or "/cplatform/getAd" (exact segments; "getAd" is case-sensitive; trailing slash tolerated). */
export function isNoasPath(pathPattern: string): boolean {
  const p =
    pathPattern.length > 1 && pathPattern.endsWith("/") ? pathPattern.slice(0, -1) : pathPattern;
  return p === "/getAd" || p === "/cplatform/getAd";
}

export const NOAS_RESOURCE_TYPES = new Set([
  "script",
  "xmlhttprequest",
  "sub_frame",
  "image",
  "other",
]);

export function isThirdParty(e: NormalizedEvent): boolean {
  return e.frameContext.thirdParty === true;
}

export function hasThirdPartyFlag(e: NormalizedEvent, ...flags: string[]): boolean {
  const tp = e.frameContext.urlClassification?.thirdParty ?? [];
  return tp.some((f) => flags.includes(f));
}

export function hasAnyFlag(e: NormalizedEvent, flag: string): boolean {
  const c = e.frameContext.urlClassification;
  if (!c) return false;
  return c.thirdParty.some((f) => f === flag) || c.firstParty.some((f) => f === flag);
}

const JS_TYPES = new Set([
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
  "application/ecmascript",
  "text/ecmascript",
  "text/jscript",
]);
export function isJsContentType(ct: string | undefined): boolean {
  return ct !== undefined && JS_TYPES.has(ct.toLowerCase());
}

/** Observed response size: inspected byte count, else Content-Length. */
export function responseBytes(e: NormalizedEvent): number | undefined {
  if (e.responseInspection) return e.responseInspection.observedBytes;
  return e.responseSizeIfObservable;
}

const MULTI_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "co.jp",
  "ne.jp",
  "or.jp",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "com.br",
  "com.cn",
  "com.mx",
  "co.in",
  "co.kr",
  "co.za",
  "com.tr",
  "com.sg",
  "com.hk",
]);
/**
 * Registrable domain (eTLD+1) via the bundled Public Suffix List; falls back to a small
 * multi-part suffix heuristic when the PSL yields nothing (IPs, single labels, unknown TLDs).
 */
export function approxRegistrableDomain(hostname: string): string {
  const psl = registrableDomain(hostname);
  if (psl) return psl;
  // The PSL knows the host but it IS a public suffix (e.g. "a.kawasaki.jp"): keep it whole
  // rather than collapsing distinct sites into their shared suffix.
  if (publicSuffix(hostname) === normalizeHostname(hostname)) return hostname.toLowerCase();
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return hostname;
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/** True when this event is the first sighting of its request (request_started, or no earlier event for the id). */
export function isFirstObservation(e: NormalizedEvent, ctx: RuleContext): boolean {
  if (e.eventType === "request_started") return true;
  if (
    e.eventType === "response_inspected" ||
    e.eventType === "frame_navigated" ||
    e.eventType === "page_signal"
  )
    return false;
  if (e.requestId === undefined) return true;
  return ctx.window.byRequestId(e.requestId).length === 0;
}

/**
 * Events in the same tab or correlation group within the correlation window before `e`
 * (exclusive of `e`), in timestamp order. The window is kept in insertion order, which is
 * almost always chronological, so the result is only sorted (O(R log R)) when an out-of-order
 * arrival is detected (for example a page signal delivered after a later request); otherwise
 * the cost is O(R).
 */
export function relatedEvents(e: NormalizedEvent, ctx: RuleContext): NormalizedEvent[] {
  const cutoff = e.timestamp - ctx.settings.correlationWindowMs;
  const seen = new Set<string>([e.eventId]);
  const out: NormalizedEvent[] = [];
  const add = (list: readonly NormalizedEvent[]): void => {
    for (const x of list) {
      if (seen.has(x.eventId)) continue;
      seen.add(x.eventId);
      if (x.timestamp < cutoff || x.timestamp > e.timestamp) continue;
      out.push(x);
    }
  };
  if (e.tabId !== undefined && e.tabId >= 0) add(ctx.window.byTab(e.tabId));
  if (e.correlationId !== undefined) add(ctx.window.byCorrelationId(e.correlationId));
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.timestamp < out[i - 1]!.timestamp) {
      out.sort((a, b) => a.timestamp - b.timestamp);
      break;
    }
  }
  return out;
}

export function dayKeyUtc(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function classMatches(matches: IndicatorMatch[], cls: string): IndicatorMatch[] {
  return matches.filter((m) => m.indicator.classification === cls);
}

export interface DetectionArgs {
  subject: string;
  severity?: Severity;
  confidence?: Confidence;
  confidenceRationale: string;
  summary: string;
  significance: string;
  evidence: EvidenceItem[];
  /** All contributing events; the last one is treated as the trigger. */
  events: readonly NormalizedEvent[];
  matchedIndicatorIds?: string[];
  subjectHostnames: string[];
  alternativeExplanations: string[];
  recommendedActions?: string[];
  limitations?: string[];
  references?: DetectionReference[];
  /** Additional observation limitations to describe in missingVisibility (e.g. frame ancestry). */
  extraLimitations?: ObservationLimitation[];
}

export function buildDetection(def: RuleDefinition, ctx: RuleContext, a: DetectionArgs): Detection {
  const events = [...a.events].sort((x, y) => x.timestamp - y.timestamp);
  const trigger = a.events[a.events.length - 1];
  const first = events[0];
  const tabId = trigger?.tabId;
  const eventIds: string[] = [];
  for (const e of events) if (!eventIds.includes(e.eventId)) eventIds.push(e.eventId);
  return {
    detectionId: newId(),
    timestamp: trigger?.timestamp ?? ctx.now,
    firstEventTimestamp: first?.timestamp ?? ctx.now,
    ruleId: def.id,
    ruleVersion: def.version,
    ruleName: def.name,
    category: def.category,
    severity: a.severity ?? def.severity,
    confidence: a.confidence ?? def.confidence,
    confidenceRationale: a.confidenceRationale,
    summary: a.summary,
    significance: a.significance,
    evidence: a.evidence,
    eventIds,
    matchedIndicatorIds: [...new Set(a.matchedIndicatorIds ?? [])],
    missingVisibility: missingVisibilityFor(events, ctx.capabilities, a.extraLimitations),
    alternativeExplanations: a.alternativeExplanations,
    recommendedActions: a.recommendedActions ?? DEFAULT_ACTIONS,
    limitations: a.limitations ?? def.limitations,
    references: a.references ?? def.references,
    dedupKey: fnv1a(def.id + "|" + a.subject),
    occurrenceCount: 1,
    subjectHostnames: [...new Set(a.subjectHostnames)],
    ...(tabId !== undefined ? { tabId } : {}),
  };
}

const SEVERITY_ORDER: readonly Severity[] = [
  "informational",
  "suspicious",
  "elevated",
  "high_priority",
];
/** One severity level lower (informational stays informational). */
export function lowerSeverity(s: Severity): Severity {
  return SEVERITY_ORDER[Math.max(0, SEVERITY_RANK[s] - 1)]!;
}

const CONFIDENCE_ORDER: readonly Confidence[] = ["low", "medium", "high"];
/** One confidence step lower (low stays low). */
export function lowerConfidence(c: Confidence): Confidence {
  return CONFIDENCE_ORDER[Math.max(0, CONFIDENCE_ORDER.indexOf(c) - 1)]!;
}

export function maxConfidence(a: Confidence, b: Confidence): Confidence {
  const r: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
  return r[a] >= r[b] ? a : b;
}
