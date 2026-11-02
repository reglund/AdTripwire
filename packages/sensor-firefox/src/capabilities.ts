import type { SensorCapabilities, SensorCapability } from "@adtripwire/shared";

/**
 * Detects what THIS browser build actually exposes. Nothing is assumed: each
 * capability is probed via feature detection on the `browser` global.
 */
export async function detectCapabilities(): Promise<SensorCapabilities> {
  const caps: SensorCapability[] = [];
  const notes: string[] = [];
  const wr = (globalThis as unknown as { browser?: typeof browser }).browser?.webRequest;

  if (wr && typeof wr.onBeforeRequest?.addListener === "function") {
    caps.push("request_metadata", "redirect_chain", "response_headers", "response_size");
    notes.push(
      "Response size is read from the Content-Length header when present; chunked or compressed responses may not report a size.",
    );
  } else {
    notes.push("webRequest API unavailable: no network observation possible.");
  }

  if (wr && typeof (wr as { filterResponseData?: unknown }).filterResponseData === "function") {
    caps.push("response_body_inspection");
    notes.push(
      "Response bodies are inspected only for requests to documented indicator hosts or NOAS-pattern paths, passed through byte-for-byte.",
    );
  } else {
    notes.push(
      "webRequest.filterResponseData unavailable: JavaScript response content cannot be inspected.",
    );
  }

  // Firefox-only details fields. Presence is verified at runtime on the first event; declared here
  // from engine identity because they cannot be feature-detected without a request.
  let browserVersion: string | undefined;
  let isFirefox = false;
  try {
    const info = await browser.runtime.getBrowserInfo();
    isFirefox = /firefox/i.test(info.name);
    browserVersion = info.version;
  } catch {
    notes.push("runtime.getBrowserInfo unavailable; browser identity unknown.");
  }
  if (isFirefox) {
    caps.push("frame_ancestry", "third_party_flag", "url_classification");
    notes.push(
      "Tracking classification flags come from Firefox Tracking Protection lists and are absent when a host is not listed; absence is not a benign signal.",
    );
  }

  const result: SensorCapabilities = {
    browser: isFirefox ? "firefox" : "unknown",
    capabilities: caps,
    notes,
  };
  if (browserVersion !== undefined) result.browserVersion = browserVersion;
  return result;
}
