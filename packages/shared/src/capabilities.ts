import type { BrowserName } from "./events.js";

/**
 * Capability declarations let the engine decide which rules can run on a
 * given browser. Rules requiring an unavailable capability are reported as
 * "not evaluable", never silently skipped.
 */
export type SensorCapability =
  | "request_metadata" // url, type, method, status
  | "redirect_chain"
  | "frame_ancestry" // Firefox frameAncestors
  | "third_party_flag"
  | "url_classification" // Firefox Tracking Protection flags
  | "response_headers"
  | "response_body_inspection" // Firefox filterResponseData
  | "response_size";

export interface SensorCapabilities {
  browser: BrowserName;
  browserVersion?: string;
  capabilities: SensorCapability[];
  /** Human-readable notes, e.g. why a capability is missing. */
  notes: string[];
}
