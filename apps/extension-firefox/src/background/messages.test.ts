import { describe, expect, it, beforeAll } from "vitest";
import { isTrustedSender, parseUiRequest } from "./messages.js";

beforeAll(() => {
  (globalThis as unknown as { browser: unknown }).browser = { runtime: { id: "adtripwire@test" } };
});

const base = "moz-extension://abc-123/";

describe("isTrustedSender", () => {
  it("accepts the extension's own pages", () => {
    expect(isTrustedSender({ id: "adtripwire@test", url: `${base}popup.html` }, base)).toBe(true);
  });
  it("rejects other extensions, web pages and framed senders", () => {
    expect(isTrustedSender({ id: "other@ext", url: `${base}popup.html` }, base)).toBe(false);
    expect(
      isTrustedSender({ id: "adtripwire@test", url: "https://evil.synthetic.test/" }, base),
    ).toBe(false);
    expect(isTrustedSender({ id: "adtripwire@test" }, base)).toBe(false);
    expect(
      isTrustedSender(
        {
          id: "adtripwire@test",
          url: `${base}x.html`,
          tab: {
            id: 1,
            index: 0,
            highlighted: false,
            active: true,
            pinned: false,
            incognito: false,
          },
          frameId: 3,
        },
        base,
      ),
    ).toBe(false);
  });
});

describe("parseUiRequest", () => {
  it("accepts well-formed requests", () => {
    expect(parseUiRequest({ type: "get_status" })).toEqual({ type: "get_status" });
    expect(
      parseUiRequest({ type: "list_detections", filter: { severities: ["elevated"], limit: 10 } }),
    ).toEqual({
      type: "list_detections",
      filter: { severities: ["elevated"], limit: 10 },
    });
    expect(parseUiRequest({ type: "update_settings", patch: { enabled: false } })).toEqual({
      type: "update_settings",
      patch: { enabled: false },
    });
    expect(
      parseUiRequest({ type: "export_evidence", profile: "strict", detectionIds: ["a"] }),
    ).toEqual({ type: "export_evidence", profile: "strict", detectionIds: ["a"] });
  });
  it("rejects malformed, oversized or unknown requests", () => {
    expect(parseUiRequest(null)).toBeNull();
    expect(parseUiRequest("get_status")).toBeNull();
    expect(parseUiRequest({ type: "nuke" })).toBeNull();
    expect(parseUiRequest({ type: "get_detection", detectionId: 5 })).toBeNull();
    expect(parseUiRequest({ type: "get_detection", detectionId: "x".repeat(65) })).toBeNull();
    expect(
      parseUiRequest({
        type: "get_events",
        eventIds: Array.from({ length: 1001 }, (_, i) => String(i)),
      }),
    ).toBeNull();
    expect(parseUiRequest({ type: "update_settings", patch: { __proto__x: 1 } })).toBeNull();
    expect(parseUiRequest({ type: "update_settings", patch: { enabled: "yes" } })).toBeNull();
    expect(parseUiRequest({ type: "export_evidence", profile: "raw" })).toBeNull();
    expect(parseUiRequest({ type: "list_detections", filter: { limit: 0 } })).toBeNull();
    expect(parseUiRequest({ type: "list_detections", filter: { since: "yesterday" } })).toBeNull();
  });
  it("does not let prototype keys through the settings patch", () => {
    const raw = JSON.parse('{"type":"update_settings","patch":{"constructor":true}}');
    expect(parseUiRequest(raw)).toBeNull();
  });
});

describe("isPageSensorSender", () => {
  const tab = {
    id: 4,
    index: 0,
    highlighted: false,
    active: true,
    pinned: false,
    incognito: false,
  };
  it("accepts our content script in an http(s) sub-frame of a tab", async () => {
    const { isPageSensorSender } = await import("./messages.js");
    expect(
      isPageSensorSender({
        id: "adtripwire@test",
        tab,
        frameId: 9,
        url: "https://ad.synthetic-exchange.test/c.html",
      }),
    ).toBe(true);
  });
  it("rejects top frames, other extensions, non-tab senders and non-http frames", async () => {
    const { isPageSensorSender } = await import("./messages.js");
    expect(
      isPageSensorSender({ id: "adtripwire@test", tab, frameId: 0, url: "https://x.test/" }),
    ).toBe(false);
    expect(isPageSensorSender({ id: "other@ext", tab, frameId: 9, url: "https://x.test/" })).toBe(
      false,
    );
    expect(isPageSensorSender({ id: "adtripwire@test", frameId: 9, url: "https://x.test/" })).toBe(
      false,
    );
    expect(
      isPageSensorSender({
        id: "adtripwire@test",
        tab,
        frameId: 9,
        url: "moz-extension://abc/popup.html",
      }),
    ).toBe(false);
  });
});
