import { describe, expect, it } from "vitest";
import { buildChromiumEvent, type ChromiumRequestDetails } from "./event-builder.js";
import { FrameTreeCache } from "./frame-tree.js";

const base = (over: Partial<ChromiumRequestDetails> = {}): ChromiumRequestDetails => ({
  requestId: "r1",
  url: "https://ads.example/getAd?uid=SECRETVALUE123&slot=7",
  method: "GET",
  type: "script",
  tabId: 3,
  frameId: 0,
  parentFrameId: -1,
  timeStamp: 1_700_000_000_000,
  ...over,
});

function tree(): FrameTreeCache {
  const t = new FrameTreeCache();
  t.onCommitted({ tabId: 3, frameId: 0, parentFrameId: -1, url: "https://news.example/a?q=1" });
  t.onCommitted({ tabId: 3, frameId: 4, parentFrameId: 0, url: "https://adframe.example/slot" });
  return t;
}

describe("buildChromiumEvent", () => {
  it("keeps the initiator origin and strips query values everywhere", () => {
    const ev = buildChromiumEvent("started", base({ initiator: "https://news.example" }), tree())!;
    expect(ev.browser).toBe("chromium");
    expect(ev.eventType).toBe("request_started");
    expect(ev.initiatorOrigin).toBe("https://news.example");
    expect(ev.destination.hostname).toBe("ads.example");
    expect(ev.destination.pathPattern).toBe("/getAd");
    expect(ev.destination.queryParamNames).toEqual(["slot", "uid"]);
    expect(JSON.stringify(ev)).not.toContain("SECRETVALUE123");
  });

  it("drops an opaque 'null' initiator", () => {
    const ev = buildChromiumEvent("started", base({ initiator: "null" }), tree())!;
    expect(ev.initiatorOrigin).toBeUndefined();
  });

  it("redirect events keep only the redirect hostname", () => {
    const ev = buildChromiumEvent(
      "redirected",
      base({ redirectUrl: "https://track.example/p?id=SECRETVALUE123" }),
      tree(),
    )!;
    expect(ev.redirectHostname).toBe("track.example");
    expect(JSON.stringify(ev)).not.toContain("SECRETVALUE123");
  });

  it("uses tree ancestry for requests inside a sub-frame", () => {
    const ev = buildChromiumEvent(
      "started",
      base({ frameId: 4, parentFrameId: 0, initiator: "https://adframe.example" }),
      tree(),
    )!;
    expect(ev.frameContext).toMatchObject({
      frameId: 4,
      parentFrameId: 0,
      ancestorHostnames: ["news.example"],
      ancestorFrameIds: [0],
      depth: 1,
      documentHostname: "adframe.example",
      topHostname: "news.example",
      thirdParty: true,
    });
    expect(ev.observationLimitations).not.toContain("frame_ancestry_unavailable");
  });

  it("sub_frame requests start the chain at the parent frame", () => {
    const ev = buildChromiumEvent(
      "started",
      base({ type: "sub_frame", frameId: 11, parentFrameId: 4, url: "https://deep.example/f" }),
      tree(),
    )!;
    expect(ev.frameContext.ancestorFrameIds).toEqual([4, 0]);
    expect(ev.frameContext.ancestorHostnames).toEqual(["adframe.example", "news.example"]);
    expect(ev.frameContext.depth).toBe(2);
    expect(ev.frameContext.documentHostname).toBe("adframe.example");
  });

  it("falls back and records frame_ancestry_unavailable when the frame is unknown", () => {
    const ev = buildChromiumEvent("started", base({ frameId: 42, parentFrameId: 0 }), tree())!;
    expect(ev.frameContext.depth).toBe(1);
    expect(ev.frameContext.ancestorFrameIds).toBeUndefined();
    expect(ev.observationLimitations).toContain("frame_ancestry_unavailable");
    const noTree = buildChromiumEvent(
      "started",
      base({ frameId: 42, parentFrameId: 0 }),
      undefined,
    )!;
    expect(noTree.observationLimitations).toContain("frame_ancestry_unavailable");
  });

  it("infers thirdParty false for same-site requests (registrable domain)", () => {
    const ev = buildChromiumEvent(
      "started",
      base({ url: "https://static.news.example/app.js", initiator: "https://www.news.example" }),
      tree(),
    )!;
    expect(ev.frameContext.topHostname).toBe("www.news.example");
    expect(ev.frameContext.thirdParty).toBe(false);
  });

  it("infers thirdParty true for cross-site requests", () => {
    const ev = buildChromiumEvent("started", base({ initiator: "https://news.example" }), tree())!;
    expect(ev.frameContext.thirdParty).toBe(true);
  });

  it("omits thirdParty when the document or top host is unknown", () => {
    const ev = buildChromiumEvent(
      "started",
      base({ frameId: 42, parentFrameId: 7, tabId: 9 }),
      new FrameTreeCache(),
    )!;
    expect("thirdParty" in ev.frameContext).toBe(false);
    const noInit = buildChromiumEvent("started", base({ tabId: -1 }), undefined)!;
    expect("thirdParty" in noInit.frameContext).toBe(false);
  });

  it("uses topHostnameHint when the tree has no top frame", () => {
    const ev = buildChromiumEvent(
      "started",
      base({ frameId: 42, parentFrameId: 7, initiator: "https://frame.example" }),
      new FrameTreeCache(),
      "news.example",
    )!;
    expect(ev.frameContext.topHostname).toBe("news.example");
    expect(ev.frameContext.thirdParty).toBe(true);
  });

  it("main_frame requests are top-level and first-party to themselves", () => {
    const ev = buildChromiumEvent(
      "started",
      base({ type: "main_frame", url: "https://next.example/" }),
      tree(),
    )!;
    expect(ev.frameContext).toMatchObject({
      depth: 0,
      ancestorFrameIds: [],
      topHostname: "next.example",
      thirdParty: false,
    });
  });

  it("always records url_classification_unavailable and no_response_body_access", () => {
    for (const phase of ["started", "redirected", "completed", "error"] as const) {
      const ev = buildChromiumEvent(phase, base(), tree())!;
      expect(ev.observationLimitations).toContain("url_classification_unavailable");
      expect(ev.observationLimitations).toContain("no_response_body_access");
      expect(ev.frameContext.urlClassification).toBeUndefined();
      expect(ev.responseInspection).toBeUndefined();
    }
  });

  it("maps webbundle to other and keeps known types", () => {
    expect(buildChromiumEvent("started", base({ type: "webbundle" }), tree())!.resourceType).toBe(
      "other",
    );
    expect(buildChromiumEvent("started", base({ type: "ping" }), tree())!.resourceType).toBe(
      "ping",
    );
  });

  it("parses Content-Length and records response_size_unknown when missing or invalid", () => {
    const ok = buildChromiumEvent(
      "completed",
      base({
        statusCode: 200,
        ip: "192.0.2.1",
        responseHeaders: [{ name: "Content-Length", value: " 1234 " }],
      }),
      tree(),
    )!;
    expect(ok.statusCode).toBe(200);
    expect(ok.responseSizeIfObservable).toBe(1234);
    expect(ok.observationLimitations).not.toContain("response_size_unknown");
    expect(JSON.stringify(ok)).not.toContain("192.0.2.1");

    const missing = buildChromiumEvent("completed", base({ responseHeaders: [] }), tree())!;
    expect(missing.responseSizeIfObservable).toBeUndefined();
    expect(missing.observationLimitations).toContain("response_size_unknown");

    const bad = buildChromiumEvent(
      "completed",
      base({ responseHeaders: [{ name: "content-length", value: "12abc" }] }),
      tree(),
    )!;
    expect(bad.observationLimitations).toContain("response_size_unknown");
  });

  it("records from_cache", () => {
    const ev = buildChromiumEvent("completed", base({ fromCache: true }), tree())!;
    expect(ev.fromCache).toBe(true);
    expect(ev.observationLimitations).toContain("from_cache");
  });

  it("returns null for unsanitizable URLs", () => {
    expect(buildChromiumEvent("started", base({ url: "not a url" }), tree())).toBeNull();
  });
});
