import type { SensorCapabilities, SensorCapability } from "@adtripwire/shared";

/** The exact capability set the Chromium MV3 sensor provides. */
export const CHROMIUM_CAPABILITIES: readonly SensorCapability[] = [
  "request_metadata",
  "redirect_chain",
  "response_headers",
  "response_size",
  "frame_ancestry",
];

export const CHROMIUM_CAPABILITY_NOTES: readonly string[] = [
  "Response bodies cannot be inspected on Chromium MV3: webRequest is observational only (no webRequestBlocking, no filterResponseData), so JavaScript response content is never analysed and rules that need response body inspection are not evaluable.",
  "Frame ancestry is reconstructed asynchronously from webNavigation (onCommitted, getAllFrames); it may lag behind requests, and events whose frame was not yet known carry the frame_ancestry_unavailable limitation.",
  "Third-party status is inferred by comparing the registrable domain of the request initiator (and destination) against the top-frame hostname; it is omitted when either side is unknown. There is no browser-provided third-party flag.",
  "Tracking classification flags (Firefox urlClassification) are unavailable on Chromium; absence of a flag is not a benign signal.",
  "Response size is read from the Content-Length header when present; chunked or compressed responses may not report a size.",
];

/** Parses the major.minor... version from a Chromium user agent ("Chrome/131.0.6778.85"). */
export function chromiumVersionFromUserAgent(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  const m = /\b(?:Chrome|Chromium)\/(\d+(?:\.\d+){0,3})/.exec(ua);
  return m ? m[1] : undefined;
}

/**
 * Capability declaration for the Chromium MV3 sensor. Static by design: Chromium MV3 never
 * offers response body inspection, a third-party flag or URL classification to extensions,
 * so those are never claimed.
 */
export function detectChromiumCapabilities(): Promise<SensorCapabilities> {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  const version = chromiumVersionFromUserAgent(nav?.userAgent);
  const result: SensorCapabilities = {
    browser: "chromium",
    capabilities: [...CHROMIUM_CAPABILITIES],
    notes: [...CHROMIUM_CAPABILITY_NOTES],
  };
  if (version !== undefined) result.browserVersion = version;
  return Promise.resolve(result);
}
