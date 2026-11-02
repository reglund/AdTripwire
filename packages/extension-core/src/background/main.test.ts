import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "@adtripwire/shared";
import { isExtensionOriginated } from "./main.js";

const base: NormalizedEvent = {
  eventId: "e",
  timestamp: 0,
  browser: "firefox",
  sensor: "webrequest",
  eventType: "request_started",
  destination: {
    scheme: "http",
    hostname: "127.0.0.1",
    pathPattern: "/api/chat",
    queryParamNames: [],
    redacted: false,
  },
  frameContext: { frameId: 0, parentFrameId: -1, ancestorHostnames: [], depth: 0 },
  requestStatus: "started",
  matchedIndicators: [],
  matchedRules: [],
  evidenceQuality: "direct",
  observationLimitations: [],
};

describe("isExtensionOriginated", () => {
  it("recognises requests issued by extension pages in both browsers", () => {
    expect(isExtensionOriginated({ ...base, initiatorOrigin: "moz-extension://abc" })).toBe(true);
    expect(isExtensionOriginated({ ...base, initiatorOrigin: "chrome-extension://abc" })).toBe(
      true,
    );
    expect(
      isExtensionOriginated({
        ...base,
        frameContext: { ...base.frameContext, documentHostname: "moz-extension://abc" },
      }),
    ).toBe(true);
  });
  it("leaves web-page traffic alone", () => {
    expect(isExtensionOriginated({ ...base, initiatorOrigin: "https://news.synthetic.test" })).toBe(
      false,
    );
    expect(isExtensionOriginated(base)).toBe(false);
  });
});
