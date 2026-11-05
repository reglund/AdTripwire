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

describe("parseUiRequest Phase 4", () => {
  it("accepts well-formed research requests", () => {
    expect(
      parseUiRequest({ type: "export_stix", includeIndicators: true, detectionIds: ["a"] }),
    ).toEqual({ type: "export_stix", includeIndicators: true, detectionIds: ["a"] });
    expect(parseUiRequest({ type: "export_siem" })).toEqual({ type: "export_siem" });
    expect(parseUiRequest({ type: "export_handoff", profile: "strict" })).toEqual({
      type: "export_handoff",
      profile: "strict",
    });
    expect(
      parseUiRequest({ type: "import_indicator_set", format: "stix", text: "{}", enabled: true }),
    ).toEqual({ type: "import_indicator_set", format: "stix", text: "{}", enabled: true });
    expect(parseUiRequest({ type: "set_detection_note", detectionId: "d", note: "n" })).toEqual({
      type: "set_detection_note",
      detectionId: "d",
      note: "n",
    });
    expect(parseUiRequest({ type: "get_timeline", tabId: 3, since: 1, limit: 10 })).toEqual({
      type: "get_timeline",
      tabId: 3,
      since: 1,
      limit: 10,
    });
  });
  it("rejects malformed research requests", () => {
    expect(parseUiRequest({ type: "export_stix" })).toBeNull();
    expect(
      parseUiRequest({ type: "import_indicator_set", format: "csv", text: "x", enabled: true }),
    ).toBeNull();
    expect(
      parseUiRequest({ type: "import_indicator_set", format: "stix", text: "", enabled: true }),
    ).toBeNull();
    expect(
      parseUiRequest({ type: "set_detection_note", detectionId: "d", note: "x".repeat(4001) }),
    ).toBeNull();
    expect(parseUiRequest({ type: "get_timeline", limit: 0 })).toBeNull();
    expect(parseUiRequest({ type: "remove_indicator_set", setId: 5 })).toBeNull();
  });
});

describe("parseUiRequest Phase 5", () => {
  it("accepts cluster requests only with well-formed ids", () => {
    expect(parseUiRequest({ type: "get_clusters" })).toEqual({ type: "get_clusters" });
    expect(parseUiRequest({ type: "get_cluster", clusterId: "c-0123abcd" })).toEqual({
      type: "get_cluster",
      clusterId: "c-0123abcd",
    });
    expect(parseUiRequest({ type: "get_cluster", clusterId: "c-xyz" })).toBeNull();
    expect(parseUiRequest({ type: "get_cluster", clusterId: "<img>" })).toBeNull();
  });

  it("requires exactly one target for assist packages and validates language", () => {
    expect(parseUiRequest({ type: "get_assist_package", detectionId: "d1" })).toEqual({
      type: "get_assist_package",
      detectionId: "d1",
    });
    expect(
      parseUiRequest({ type: "get_assist_package", clusterId: "c-0123abcd", language: "nb" }),
    ).toEqual({ type: "get_assist_package", clusterId: "c-0123abcd", language: "nb" });
    expect(parseUiRequest({ type: "get_assist_package" })).toBeNull();
    expect(
      parseUiRequest({ type: "get_assist_package", detectionId: "d1", clusterId: "c-0123abcd" }),
    ).toBeNull();
    expect(
      parseUiRequest({ type: "get_assist_package", detectionId: "d1", language: "fr" }),
    ).toBeNull();
    expect(parseUiRequest({ type: "get_assist_package", detectionId: "x".repeat(65) })).toBeNull();
  });

  it("validates assist settings patches strictly", () => {
    expect(
      parseUiRequest({
        type: "update_assist_settings",
        patch: { enabled: true, port: 11434, model: "qwen3:8b", language: "en" },
      }),
    ).toEqual({
      type: "update_assist_settings",
      patch: { enabled: true, port: 11434, model: "qwen3:8b", language: "en" },
    });
    expect(parseUiRequest({ type: "update_assist_settings", patch: { port: 0 } })).toBeNull();
    expect(parseUiRequest({ type: "update_assist_settings", patch: { port: 70000 } })).toBeNull();
    expect(
      parseUiRequest({ type: "update_assist_settings", patch: { model: "bad model" } }),
    ).toBeNull();
    expect(
      parseUiRequest({ type: "update_assist_settings", patch: { model: "-leading" } }),
    ).toBeNull();
    expect(
      parseUiRequest({ type: "update_assist_settings", patch: { language: "de" } }),
    ).toBeNull();
    expect(parseUiRequest({ type: "update_assist_settings", patch: { other: 1 } })).toBeNull();
    expect(parseUiRequest({ type: "update_assist_settings", patch: { model: "" } })).toEqual({
      type: "update_assist_settings",
      patch: { model: "" },
    });
  });
});

describe("parseUiRequest exposure", () => {
  it("accepts get_exposure without parameters", () => {
    expect(parseUiRequest({ type: "get_exposure" })).toEqual({ type: "get_exposure" });
  });
});

describe("parseUiRequest digest", () => {
  it("accepts get_digest without parameters", () => {
    expect(parseUiRequest({ type: "get_digest" })).toEqual({ type: "get_digest" });
  });
});
