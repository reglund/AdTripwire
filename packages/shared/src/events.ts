/**
 * Normalized sensor event model.
 *
 * Sensors (browser-specific adapters) translate raw browser API callbacks into
 * these events. The detection engine consumes ONLY this model and never touches
 * browser APIs directly. Every field here is either directly observable by the
 * sensor or explicitly marked as unavailable; sensors must never invent values.
 */

export type BrowserName = "firefox" | "chromium" | "unknown";

/** Which sensor produced the event. Mirrors the sensor's capability declaration. */
export type SensorName =
  | "webrequest" // request/response metadata from webRequest.*
  | "response-filter" // response body inspection (Firefox filterResponseData)
  | "navigation" // webNavigation frame lifecycle
  | "page" // optional, opt-in content-script sensor in sub-frames (Phase 2)
  | "synthetic"; // test fixtures only; never produced in production

/** Resource types as exposed by the WebExtensions webRequest API (Firefox set). */
export type ResourceType =
  | "beacon"
  | "csp_report"
  | "font"
  | "image"
  | "imageset"
  | "json"
  | "main_frame"
  | "media"
  | "object"
  | "object_subrequest"
  | "ping"
  | "script"
  | "speculative"
  | "stylesheet"
  | "sub_frame"
  | "web_manifest"
  | "websocket"
  | "xml_dtd"
  | "xmlhttprequest"
  | "xslt"
  | "other";

/**
 * Firefox Tracking Protection classification flags (webRequest details.urlClassification).
 * Only populated when Firefox's tracking lists classify the request. Absence of a flag
 * is NOT evidence that a host is benign.
 */
export type UrlClassificationFlag =
  | "fingerprinting"
  | "fingerprinting_content"
  | "cryptomining"
  | "cryptomining_content"
  | "tracking"
  | "tracking_ad"
  | "tracking_analytics"
  | "tracking_social"
  | "tracking_content"
  | "emailtracking"
  | "emailtracking_content"
  | "any_basic_tracking"
  | "any_strict_tracking"
  | "any_social_tracking";

export interface UrlClassification {
  firstParty: UrlClassificationFlag[];
  thirdParty: UrlClassificationFlag[];
}

/**
 * Where in the frame tree a request originated. Only hostnames are retained;
 * full ancestor URLs are never stored.
 */
export interface FrameContext {
  /** 0 for the top-level document, >0 for sub-frames, -1 when unknown. */
  frameId: number;
  parentFrameId: number;
  /** Hostname of the document that issued the request (sanitized), if observable. */
  documentHostname?: string;
  /** Hostname of the top-level document, if observable. */
  topHostname?: string;
  /** Ancestor document hostnames from immediate parent up to the top-level document. */
  ancestorHostnames: string[];
  /**
   * Ancestor frame ids, same order as ancestorHostnames (Firefox frameAncestors). Enables
   * frame-lineage correlation: two events are lineage-related when one's frameId appears in
   * the other's ancestry or they share a frameId.
   */
  ancestorFrameIds?: number[];
  /** Depth in the frame tree: 0 = top document, 1 = direct child iframe, ... */
  depth: number;
  /** True when the request and its window hierarchy are third-party relative to the top document. */
  thirdParty?: boolean;
  /** Firefox Tracking Protection classification for this request, if provided. */
  urlClassification?: UrlClassification;
}

/**
 * Sanitized view of a URL. Produced by @adtripwire/privacy. Never contains query
 * values, fragments, credentials, or arbitrary path segments that look like tokens.
 */
export interface SanitizedUrl {
  scheme: "http" | "https" | "ws" | "wss" | "other";
  hostname: string;
  /** Port only when non-default. */
  port?: number;
  /** Path with token-like segments replaced by placeholders, e.g. "/getAd" or "/u/{id}/track". */
  pathPattern: string;
  /** Query parameter NAMES only, lower-cased, de-duplicated, sorted. Values are never retained. */
  queryParamNames: string[];
  /** True if the sanitizer redacted anything (tokens in path, long segments, etc.). */
  redacted: boolean;
}

export type RequestStatus =
  "started" | "redirected" | "headers_received" | "completed" | "error" | "unknown";

export type EventType =
  | "request_started"
  | "request_redirected"
  | "request_headers_received"
  | "request_completed"
  | "request_error"
  | "response_inspected"
  | "frame_navigated"
  | "page_signal";

/** Observation-level caveats attached by the sensor. */
export type ObservationLimitation =
  | "no_response_body_access"
  | "response_body_truncated"
  | "response_body_skipped_budget"
  | "response_body_unsupported_encoding"
  | "frame_ancestry_unavailable"
  | "url_classification_unavailable"
  | "response_size_unknown"
  | "from_cache"
  | "incognito_excluded"
  | "sensor_restarted_during_request"
  | "page_sensor_disabled";

export type EvidenceQuality = "direct" | "derived" | "partial";

/** Outcome of inspecting a response body stream (Firefox only in Phase 1). */
export interface ResponseInspection {
  /**
   * Bytes seen by the stream filter (after transfer decoding). When `truncated` is true this
   * is a lower bound: the filter disconnects at the cap and the remainder streams natively.
   * Compare with the completed event's Content-Length when present.
   */
  observedBytes: number;
  /** True if the body exceeded the analysis cap and only a prefix was analysed. */
  truncated: boolean;
  /** Lower-cased media type from Content-Type without parameters, if available. */
  contentType?: string;
  /** Whether the body was decodable as text for analysis. */
  textDecodable: boolean;
  /**
   * JavaScript technique markers found in the analysed prefix. Marker identifiers are
   * stable strings defined by the detection engine's JS analyser (e.g. "js.new_function").
   * Only marker names are stored; never the matched source text.
   */
  markers: string[];
  /** Bounded statistics used for obfuscation heuristics. */
  stats?: {
    length: number;
    /** Fraction of characters that are hex-escape or unicode-escape sequences. */
    escapeRatio: number;
    /** Average identifier length over the sampled prefix. */
    avgIdentifierLength: number;
    /** Number of string literals in the sampled prefix. */
    stringLiterals: number;
  };
}

/**
 * Signals from the optional page sensor (isolated-world content script in sub-frames).
 * Only structural facts are reported; no page text, no cookie values, no URLs beyond
 * sanitized hostnames.
 */
export type PageSignalKind =
  | "postmessage_sdk_ready" // message event with type analytics_sdk_ready (documented SDK)
  | "postmessage_wildcard_like" // message from a cross-origin frame with an object payload carrying a "type" field
  | "hidden_iframe_inserted" // iframe ≤ 2x2 px or display:none inserted after load
  | "script_inserted" // <script src> inserted after load pointing at a third-party host
  | "beacon_image_inserted"; // 1x1 image inserted after load

export interface PageSignal {
  kind: PageSignalKind;
  /** Sanitized hostname of the inserted element's target, when applicable. */
  targetHostname?: string;
  /** Whether the target host differs from the frame's own document host. */
  crossOrigin?: boolean;
  /** Milliseconds since the frame's document became interactive. */
  msSinceLoad?: number;
}

export interface NormalizedEvent {
  /** UUID v4 assigned by the sensor. */
  eventId: string;
  /** Milliseconds since epoch. */
  timestamp: number;
  browser: BrowserName;
  sensor: SensorName;
  eventType: EventType;
  /**
   * Browser request id. Stable across started/redirected/completed events for a single
   * request within a browser session. Not globally unique across restarts.
   */
  requestId?: string;
  tabId?: number;
  /** Origin (scheme://host) of the resource that triggered the request, if observable. */
  initiatorOrigin?: string;
  destination: SanitizedUrl;
  resourceType?: ResourceType;
  method?: string;
  frameContext: FrameContext;
  requestStatus: RequestStatus;
  /** HTTP status code when observed. */
  statusCode?: number;
  /** Redirect target hostname for request_redirected events. */
  redirectHostname?: string;
  /** Response size as parsed from Content-Length when observable; undefined otherwise. */
  responseSizeIfObservable?: number;
  fromCache?: boolean;
  /** Present only on response_inspected events. */
  responseInspection?: ResponseInspection;
  /** Present only on page_signal events. */
  pageSignal?: PageSignal;
  /** Indicator ids matched for this event's destination (filled by the engine). */
  matchedIndicators: string[];
  /** Rule ids that fired directly on this event (filled by the engine). */
  matchedRules: string[];
  /** Correlation key used to group events in the same request chain / frame. */
  correlationId?: string;
  evidenceQuality: EvidenceQuality;
  observationLimitations: ObservationLimitation[];
}
