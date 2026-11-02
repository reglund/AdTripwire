/**
 * Pure formatting helpers. No DOM and no browser APIs, so they can be unit-tested in Node.
 * Wording is deliberately conservative: severities are investigation priorities, not
 * probabilities of compromise.
 */
import type {
  Confidence,
  MonitoringStatus,
  DetectionCategory,
  PageSignal,
  PageSignalKind,
  SensorName,
  SanitizedUrl,
  SensorCapabilities,
  SensorCapability,
  Severity,
} from "@adtripwire/shared";

export const SEVERITY_LABELS: Record<Severity, string> = {
  informational: "Informational",
  suspicious: "Suspicious",
  elevated: "Elevated",
  high_priority: "High priority",
};

/** Ascending order of investigation priority. */
export const SEVERITY_ORDER: readonly Severity[] = [
  "informational",
  "suspicious",
  "elevated",
  "high_priority",
];

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Ascending order of confidence. */
export const CONFIDENCE_ORDER: readonly Confidence[] = ["low", "medium", "high"];

export const CATEGORY_LABELS: Record<DetectionCategory, string> = {
  known_infrastructure: "Known infrastructure",
  ad_delivery_behaviour: "Ad delivery behaviour",
  profiling: "Profiling",
  javascript_technique: "JavaScript technique",
  temporal_correlation: "Temporal correlation",
  repeated_exposure: "Repeated exposure",
};

export const CATEGORY_ORDER: readonly DetectionCategory[] = [
  "known_infrastructure",
  "ad_delivery_behaviour",
  "profiling",
  "javascript_technique",
  "temporal_correlation",
  "repeated_exposure",
];

export const CAPABILITY_LABELS: Record<SensorCapability, string> = {
  page_signals: "Page signals (opt-in sensor)",
  request_metadata: "Request metadata",
  redirect_chain: "Redirect chains",
  frame_ancestry: "Frame ancestry",
  third_party_flag: "Third-party flag",
  url_classification: "Tracking-protection classification",
  response_headers: "Response headers",
  response_body_inspection: "Script body inspection",
  response_size: "Response size",
};

/** What each capability lets the sensor observe, in plain language. */
const CAPABILITY_CAN_SEE: Record<SensorCapability, string> = {
  request_metadata:
    "Which hosts the browser contacted, with resource type, method and status (sanitized: no query values).",
  redirect_chain: "Redirects between hosts for a single request.",
  frame_ancestry: "Which frames and hostnames embedded a request (iframe nesting).",
  third_party_flag: "Whether a request was third-party relative to the page.",
  url_classification: "Firefox tracking-protection classifications, where Firefox provides them.",
  response_headers: "Selected response header metadata.",
  response_body_inspection:
    "Technique markers in a bounded prefix of selected script responses (marker names only, never source text).",
  response_size: "Response size, when the server states it.",
  page_signals:
    "Structural in-page signals from sub-frames (hidden iframe insertion, SDK messages), when the opt-in page sensor is enabled.",
};

const CAPABILITY_CANNOT_SEE: Record<SensorCapability, string> = {
  page_signals:
    "The opt-in page sensor is off, so in-page insertions and messages are not observed.",
  request_metadata: "Request metadata is not available, so most rules cannot run.",
  redirect_chain: "Redirect chains are not observable in this browser.",
  frame_ancestry:
    "Frame ancestry is not observable, so iframe-nesting patterns cannot be assessed.",
  third_party_flag: "The third-party relationship of requests is not reported.",
  url_classification: "Tracking-protection classifications are not available.",
  response_headers: "Response headers are not observable.",
  response_body_inspection: "Script contents are not inspected in this browser.",
  response_size: "Response sizes are not observable.",
};

/** Limits that apply to every installation regardless of browser capabilities. */
export const ALWAYS_CANNOT_SEE: readonly string[] = [
  "Activity in other browsers, other applications, or other devices.",
  "Network traffic that does not pass through this browser (for example DNS or operating-system connections).",
  "Page content, request bodies, cookies or form data. These are never read or stored.",
  "Anything that happened before AdTripwire was installed, while monitoring was paused, or without host permission.",
  "Compromise that does not produce the observable indicators this tool looks for, including exploitation that leaves no browser-visible trace.",
];

export const NO_DETECTIONS_NOTICE =
  "No detections does not establish that this device is free of spyware. AdTripwire only records observable indicators.";

export interface VisibilitySummary {
  canSee: string[];
  cannotSee: string[];
}

/**
 * Derives the "can / cannot see" lists from the sensor's declared capabilities. Capabilities
 * the sensor does not declare are reported as limitations, never silently omitted.
 */
export function summarizeVisibility(
  caps: Pick<SensorCapabilities, "capabilities">,
): VisibilitySummary {
  const present = new Set<SensorCapability>(caps.capabilities);
  const canSee: string[] = [];
  const cannotSee: string[] = [];
  for (const cap of Object.keys(CAPABILITY_LABELS) as SensorCapability[]) {
    if (present.has(cap)) canSee.push(CAPABILITY_CAN_SEE[cap]);
    else cannotSee.push(CAPABILITY_CANNOT_SEE[cap]);
  }
  cannotSee.push(...ALWAYS_CANNOT_SEE);
  return { canSee, cannotSee };
}

export function humanize(value: string): string {
  const s = value.replace(/[_-]+/g, " ").trim();
  return s.length === 0 ? value : s.charAt(0).toUpperCase() + s.slice(1);
}

export function severityLabel(severity: string): string {
  return (SEVERITY_LABELS as Record<string, string | undefined>)[severity] ?? humanize(severity);
}

export function confidenceLabel(confidence: string): string {
  return (
    (CONFIDENCE_LABELS as Record<string, string | undefined>)[confidence] ?? humanize(confidence)
  );
}

export function categoryLabel(category: string): string {
  return (CATEGORY_LABELS as Record<string, string | undefined>)[category] ?? humanize(category);
}

export function capabilityLabel(cap: string): string {
  return (CAPABILITY_LABELS as Record<string, string | undefined>)[cap] ?? humanize(cap);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/** English relative time ("3 minutes ago"). Falls back to a date for old timestamps. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp;
  if (!Number.isFinite(diff)) return "unknown time";
  if (diff < 45_000) return "just now"; // also covers small clock skew (negative diff)
  if (diff < HOUR) return plural(Math.max(1, Math.round(diff / MINUTE)), "minute");
  if (diff < DAY) return plural(Math.round(diff / HOUR), "hour");
  if (diff < 30 * DAY) return plural(Math.round(diff / DAY), "day");
  return new Date(timestamp).toISOString().slice(0, 10);
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** Local date and time, "YYYY-MM-DD HH:MM:SS". */
export function formatTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "unknown time";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Local time with milliseconds, "HH:MM:SS.mmm", for ordering events within a sequence. */
export function formatTimeMs(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Renders a sanitized URL as scheme://host[:port]/pathPattern?name1&name2.
 * Only parameter NAMES exist in the model; no values are ever shown.
 */
export function formatSanitizedUrl(url: SanitizedUrl): string {
  const port = url.port === undefined ? "" : `:${url.port}`;
  const names = url.queryParamNames.length > 0 ? `?${url.queryParamNames.join("&")}` : "";
  return `${url.scheme}://${url.hostname}${port}${url.pathPattern}${names}`;
}

/** Short hostname summary for table cells. */
export function formatHostnames(hostnames: readonly string[], max = 3): string {
  if (hostnames.length === 0) return "none recorded";
  if (hostnames.length <= max) return hostnames.join(", ");
  return `${hostnames.slice(0, max).join(", ")} +${hostnames.length - max} more`;
}

export function msToMinutes(ms: number): number {
  return Math.round(ms / MINUTE);
}

export function minutesToMs(minutes: number): number {
  return Math.round(minutes * MINUTE);
}

/** Parses a user-typed integer within [min, max]. Returns null when invalid. */
export function parseBoundedInt(raw: string, min: number, max: number): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < min || n > max) return null;
  return n;
}

/** Allows only http(s) URLs to become links. Returns the normalized URL or null. */
export function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function pluralize(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export type PillState = "active" | "paused" | "permission";

export const PILL_TEXT: Record<PillState, string> = {
  active: "Monitoring active",
  paused: "Monitoring paused",
  permission: "Permission required",
};

/** Missing host permission takes precedence: nothing is observed without it. */
export function monitoringPill(
  status: Pick<MonitoringStatus, "monitoring" | "hostPermissionGranted">,
): PillState {
  if (!status.hostPermissionGranted) return "permission";
  return status.monitoring ? "active" : "paused";
}

export const PAGE_SIGNAL_LABELS: Record<PageSignalKind, string> = {
  postmessage_sdk_ready: "SDK-ready message",
  postmessage_wildcard_like: "Cross-origin typed message",
  hidden_iframe_inserted: "Hidden iframe inserted",
  script_inserted: "Late third-party script inserted",
  beacon_image_inserted: "Late 1x1 image inserted",
};

export function pageSignalLabel(kind: string): string {
  return (PAGE_SIGNAL_LABELS as Record<string, string | undefined>)[kind] ?? humanize(kind);
}

export const SENSOR_LABELS: Record<SensorName, string> = {
  webrequest: "Web request",
  "response-filter": "Response filter",
  navigation: "Navigation",
  page: "Page (opt-in)",
  synthetic: "Synthetic",
};

export function sensorLabel(sensor: string): string {
  return (SENSOR_LABELS as Record<string, string | undefined>)[sensor] ?? humanize(sensor);
}

/** Milliseconds as "123 ms" or "1.5 s". Invalid input yields "unknown". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export interface PageSignalView {
  label: string;
  targetHostname: string | null;
  crossOrigin: boolean;
  /** "123 ms after load", or null when not reported. */
  timing: string | null;
}

/** Presentation facts for a page_signal event; omitted fields are never invented. */
export function describePageSignal(signal: PageSignal): PageSignalView {
  return {
    label: pageSignalLabel(signal.kind),
    targetHostname: signal.targetHostname ?? null,
    crossOrigin: signal.crossOrigin === true,
    timing:
      signal.msSinceLoad !== undefined && Number.isFinite(signal.msSinceLoad)
        ? `${formatMs(signal.msSinceLoad)} after load`
        : null,
  };
}

/** Text for a rule that cannot be evaluated. Page-sensor-only gaps point at Settings. */
export function missingCapabilitiesText(missing: readonly string[]): string {
  if (missing.length === 1 && missing[0] === "page_signals") {
    return "Requires the optional page sensor (Settings).";
  }
  return `Not evaluable in this browser (missing: ${missing.map(capabilityLabel).join(", ") || "unspecified"}).`;
}

export interface MetricRow {
  label: string;
  value: string;
}

/** Rows for the Runtime metrics card. Counts use locale grouping; means are in milliseconds. */
export function metricRows(m: NonNullable<MonitoringStatus["metrics"]>): MetricRow[] {
  const count = (n: number): string => (Number.isFinite(n) ? n.toLocaleString("en-US") : "unknown");
  return [
    { label: "Events observed", value: count(m.eventsObserved) },
    { label: "Events ingested", value: count(m.eventsIngested) },
    { label: "Response inspections", value: count(m.inspections) },
    { label: "Bytes inspected", value: formatBytes(m.inspectedBytes) },
    { label: "Mean pass-through time", value: formatMs(m.passThroughMsMean) },
    { label: "Mean analysis time", value: formatMs(m.analysisMsMean) },
    { label: "Mean ingest time", value: formatMs(m.ingestMsMean) },
    { label: "Inspections skipped for budget", value: count(m.inspectionsSkippedForBudget) },
  ];
}
