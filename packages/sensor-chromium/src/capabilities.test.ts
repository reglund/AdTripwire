import { afterEach, describe, expect, it, vi } from "vitest";
import { chromiumVersionFromUserAgent, detectChromiumCapabilities } from "./capabilities.js";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.85 Safari/537.36";

describe("detectChromiumCapabilities", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("declares exactly the Chromium MV3 capability set", async () => {
    vi.stubGlobal("navigator", { userAgent: UA });
    const caps = await detectChromiumCapabilities();
    expect(caps.browser).toBe("chromium");
    expect(caps.browserVersion).toBe("131.0.6778.85");
    expect(caps.capabilities).toEqual([
      "request_metadata",
      "redirect_chain",
      "response_headers",
      "response_size",
      "frame_ancestry",
    ]);
    for (const never of ["response_body_inspection", "third_party_flag", "url_classification"]) {
      expect(caps.capabilities).not.toContain(never);
    }
  });

  it("explains the gaps in its notes", async () => {
    const caps = await detectChromiumCapabilities();
    const notes = caps.notes.join("\n");
    expect(notes).toMatch(/filterResponseData/);
    expect(notes).toMatch(/[Rr]esponse bodies cannot be inspected/);
    expect(notes).toMatch(/initiator/);
    expect(notes).toMatch(/[Tt]racking classification/);
    expect(notes).toMatch(/asynchronously/);
  });

  it("omits the version when the user agent has no Chrome token", async () => {
    vi.stubGlobal("navigator", { userAgent: "Node.js/22" });
    const caps = await detectChromiumCapabilities();
    expect("browserVersion" in caps).toBe(false);
    expect(chromiumVersionFromUserAgent(undefined)).toBeUndefined();
  });
});
