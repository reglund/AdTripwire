import { describe, expect, it } from "vitest";
import { buildPageSignalEvent, pageSignalAllowed } from "./page-signals.js";

const sender = {
  tabId: 3,
  frameId: 7,
  frameUrl: "https://ad.synthetic-exchange.test/creative.html?x=1",
};

describe("buildPageSignalEvent", () => {
  it("accepts a well-formed hidden-iframe signal and sanitizes hosts", () => {
    const ev = buildPageSignalEvent(
      {
        type: "page_signal",
        kind: "hidden_iframe_inserted",
        targetHostname: "Staging.Synthetic-DSP.test.",
        crossOrigin: true,
        msSinceLoad: 1234.6,
      },
      sender,
      1000,
    )!;
    expect(ev.eventType).toBe("page_signal");
    expect(ev.sensor).toBe("page");
    expect(ev.pageSignal).toEqual({
      kind: "hidden_iframe_inserted",
      targetHostname: "staging.synthetic-dsp.test",
      crossOrigin: true,
      msSinceLoad: 1235,
    });
    expect(ev.frameContext.documentHostname).toBe("ad.synthetic-exchange.test");
    expect(ev.destination.hostname).toBe("ad.synthetic-exchange.test");
    expect(ev.frameContext.frameId).toBe(7);
    expect(ev.observationLimitations).toContain("frame_ancestry_unavailable");
    const withAncestry = buildPageSignalEvent(
      {
        type: "page_signal",
        kind: "script_inserted",
        targetHostname: "cdn.synthetic-dsp.test",
        crossOrigin: true,
      },
      sender,
      1000,
      {
        frameIds: [2, 0],
        hostnames: ["wrapper.synthetic-exchange.test", "news.synthetic-publisher.test"],
      },
    )!;
    expect(withAncestry.frameContext.ancestorFrameIds).toEqual([2, 0]);
    expect(withAncestry.frameContext.topHostname).toBe("news.synthetic-publisher.test");
    expect(withAncestry.frameContext.parentFrameId).toBe(2);
    expect(withAncestry.observationLimitations).toEqual([]);
    expect(JSON.stringify(ev)).not.toContain("x=1");
  });
  it("rejects top-level frames, unknown kinds, bad types and oversized values", () => {
    expect(
      buildPageSignalEvent(
        { type: "page_signal", kind: "hidden_iframe_inserted" },
        { ...sender, frameId: 0 },
        1,
      ),
    ).toBeNull();
    expect(
      buildPageSignalEvent({ type: "page_signal", kind: "cookie_dump" }, sender, 1),
    ).toBeNull();
    expect(
      buildPageSignalEvent(
        { type: "page_signal", kind: "script_inserted", targetHostname: 42 },
        sender,
        1,
      ),
    ).toBeNull();
    expect(
      buildPageSignalEvent(
        { type: "page_signal", kind: "script_inserted", targetHostname: "x".repeat(300) },
        sender,
        1,
      ),
    ).toBeNull();
    expect(
      buildPageSignalEvent(
        { type: "page_signal", kind: "script_inserted", msSinceLoad: -5 },
        sender,
        1,
      ),
    ).toBeNull();
    expect(buildPageSignalEvent({ type: "get_status" }, sender, 1)).toBeNull();
    expect(buildPageSignalEvent("page_signal", sender, 1)).toBeNull();
  });
  it("rate-limits per tab", () => {
    let ok = 0;
    for (let i = 0; i < 200; i++) if (pageSignalAllowed(99, 5_000_000 + i)) ok++;
    expect(ok).toBe(120);
    expect(pageSignalAllowed(99, 5_000_000 + 61_000)).toBe(true);
  });
});
