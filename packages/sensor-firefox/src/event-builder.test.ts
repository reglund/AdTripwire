import { describe, expect, it } from "vitest";
import { buildEvent, type RequestDetailsLike } from "./event-builder.js";
import { buildInspectionMatchPatterns, isNoasPath } from "./scope.js";

const base: RequestDetailsLike = {
  requestId: "42",
  url: "https://noas.synthetic-adfection.test/getAd?idfa=ABC-123&ipv4=10.0.0.1&cookie=a~~~b",
  method: "GET",
  type: "script",
  tabId: 7,
  frameId: 3,
  parentFrameId: 0,
  timeStamp: 1_700_000_000_000,
  originUrl: "https://ad.synthetic-exchange.test/creative.html?user=secret",
  documentUrl: "https://ad.synthetic-exchange.test/creative.html?user=secret",
  frameAncestors: [
    { url: "https://ad.synthetic-exchange.test/creative.html?user=secret", frameId: 3 },
    { url: "https://news.synthetic-publisher.test/article/123?session=xyz", frameId: 0 },
  ],
  thirdParty: true,
  urlClassification: {
    firstParty: [],
    thirdParty: ["tracking_ad", "any_basic_tracking", "bogus_flag"],
  },
};

describe("buildEvent", () => {
  it("retains hostnames, path pattern and parameter names only", () => {
    const ev = buildEvent("firefox", "started", base)!;
    expect(ev.destination.hostname).toBe("noas.synthetic-adfection.test");
    expect(ev.destination.pathPattern).toBe("/getAd");
    expect(ev.destination.queryParamNames).toEqual(["cookie", "idfa", "ipv4"]);
    const json = JSON.stringify(ev);
    expect(json).not.toContain("ABC-123");
    expect(json).not.toContain("10.0.0.1");
    expect(json).not.toContain("a~~~b");
    expect(json).not.toContain("secret");
    expect(json).not.toContain("session=");
    expect(json).not.toContain("/article/123");
  });

  it("builds frame context from Firefox ancestors", () => {
    const ev = buildEvent("firefox", "started", base)!;
    expect(ev.frameContext.depth).toBe(2);
    expect(ev.frameContext.ancestorHostnames).toEqual([
      "ad.synthetic-exchange.test",
      "news.synthetic-publisher.test",
    ]);
    expect(ev.frameContext.topHostname).toBe("news.synthetic-publisher.test");
    expect(ev.frameContext.documentHostname).toBe("ad.synthetic-exchange.test");
    expect(ev.frameContext.thirdParty).toBe(true);
    expect(ev.frameContext.urlClassification?.thirdParty).toEqual([
      "tracking_ad",
      "any_basic_tracking",
    ]);
    expect(ev.initiatorOrigin).toBe("https://ad.synthetic-exchange.test");
    expect(ev.tabId).toBe(7);
  });

  it("records limitations when Firefox-only fields are missing", () => {
    const { frameAncestors: _a, urlClassification: _u, thirdParty: _t, ...chromeLike } = base;
    const ev = buildEvent("unknown", "started", chromeLike)!;
    expect(ev.observationLimitations).toContain("frame_ancestry_unavailable");
    expect(ev.observationLimitations).toContain("url_classification_unavailable");
    expect(ev.frameContext.depth).toBe(1);
  });

  it("parses Content-Length only when numeric, else flags size unknown", () => {
    const ok = buildEvent("firefox", "completed", {
      ...base,
      statusCode: 200,
      responseHeaders: [{ name: "Content-Length", value: "0" }],
    })!;
    expect(ok.responseSizeIfObservable).toBe(0);
    expect(ok.statusCode).toBe(200);
    const chunked = buildEvent("firefox", "completed", {
      ...base,
      statusCode: 200,
      responseHeaders: [{ name: "Transfer-Encoding", value: "chunked" }],
    })!;
    expect(chunked.responseSizeIfObservable).toBeUndefined();
    expect(chunked.observationLimitations).toContain("response_size_unknown");
  });

  it("captures redirect target hostname only", () => {
    const ev = buildEvent("firefox", "redirected", {
      ...base,
      redirectUrl: "https://hop2.synthetic-redirect.test/x?token=abc",
    })!;
    expect(ev.redirectHostname).toBe("hop2.synthetic-redirect.test");
    expect(JSON.stringify(ev)).not.toContain("token=abc");
  });

  it("returns null for unparsable URLs", () => {
    expect(buildEvent("firefox", "started", { ...base, url: "not a url" })).toBeNull();
  });
});

describe("scope", () => {
  it("isNoasPath is exact and case-sensitive", () => {
    expect(isNoasPath("/getAd")).toBe(true);
    expect(isNoasPath("/cplatform/getAd")).toBe(true);
    expect(isNoasPath("/getAd/")).toBe(true);
    expect(isNoasPath("/getAd/deeper")).toBe(false);
    expect(isNoasPath("/getAdvanced")).toBe(false);
    expect(isNoasPath("/getad")).toBe(false);
    expect(isNoasPath("/x/getAd")).toBe(false);
  });

  it("builds match patterns for domains (apex + subdomains) and hostnames (exact), skipping synthetic sets", () => {
    const patterns = buildInspectionMatchPatterns([
      {
        meta: {
          id: "x",
          name: "x",
          version: "1",
          asOf: "2026-01-01",
          license: "CC0",
          synthetic: false,
          sources: [],
        },
        indicators: [
          {
            id: "a",
            indicator: "example-apex.test",
            indicatorType: "domain",
            source: "",
            sourceUrl: "",
            campaign: "",
            classification: "surveillance",
            confidence: "high",
            firstReported: "2026-01-01",
            lastReviewed: "2026-01-01",
            enabled: true,
          },
          {
            id: "b",
            indicator: "host.example-host.test",
            indicatorType: "hostname",
            source: "",
            sourceUrl: "",
            campaign: "",
            classification: "malicious",
            confidence: "high",
            firstReported: "2026-01-01",
            lastReviewed: "2026-01-01",
            enabled: true,
          },
          {
            id: "c",
            indicator: "off.example-host.test",
            indicatorType: "hostname",
            source: "",
            sourceUrl: "",
            campaign: "",
            classification: "malicious",
            confidence: "high",
            firstReported: "2026-01-01",
            lastReviewed: "2026-01-01",
            enabled: false,
          },
        ],
      },
      {
        meta: {
          id: "syn",
          name: "syn",
          version: "1",
          asOf: "2026-01-01",
          license: "",
          synthetic: true,
          sources: [],
        },
        indicators: [
          {
            id: "s",
            indicator: "c2.synthetic.test",
            indicatorType: "hostname",
            source: "",
            sourceUrl: "",
            campaign: "",
            classification: "malicious",
            confidence: "high",
            firstReported: "2026-01-01",
            lastReviewed: "2026-01-01",
            enabled: true,
          },
        ],
      },
    ]);
    expect(patterns).toContain("*://example-apex.test/*");
    expect(patterns).toContain("*://*.example-apex.test/*");
    expect(patterns).toContain("*://host.example-host.test/*");
    expect(patterns).not.toContain("*://off.example-host.test/*");
    expect(patterns).not.toContain("*://c2.synthetic.test/*");
    expect(patterns).toContain("*://*/getAd");
    expect(patterns).toContain("*://*/cplatform/getAd?*");
    expect(patterns).not.toContain("*://*/getAd/*");
  });
});
