import { describe, expect, it, vi } from "vitest";
import { FrameTreeCache, type FrameLookupApi } from "./frame-tree.js";

const nav = (tabId: number, frameId: number, parentFrameId: number, url: string) => ({
  tabId,
  frameId,
  parentFrameId,
  url,
});

describe("FrameTreeCache", () => {
  it("reconstructs ancestry immediate-parent first, top last, excluding the frame itself", () => {
    const t = new FrameTreeCache();
    t.onCommitted(nav(1, 0, -1, "https://news.example/article?id=5"));
    t.onCommitted(nav(1, 4, 0, "https://ads.example/slot"));
    t.onCommitted(nav(1, 9, 4, "https://cdn.adserver.example/creative"));
    expect(t.ancestry(1, 9)).toEqual({
      frameIds: [4, 0],
      hostnames: ["ads.example", "news.example"],
      complete: true,
    });
    expect(t.ancestry(1, 4)).toEqual({
      frameIds: [0],
      hostnames: ["news.example"],
      complete: true,
    });
    expect(t.ancestry(1, 0)).toEqual({ frameIds: [], hostnames: [], complete: true });
    expect(t.chainFrom(1, 4)).toEqual({
      frameIds: [4, 0],
      hostnames: ["ads.example", "news.example"],
      complete: true,
    });
  });

  it("returns undefined for unknown frames and tabs", () => {
    const t = new FrameTreeCache();
    t.onCommitted(nav(1, 0, -1, "https://news.example/"));
    expect(t.ancestry(1, 77)).toBeUndefined();
    expect(t.ancestry(2, 0)).toBeUndefined();
    expect(t.chainFrom(1, 77)).toBeUndefined();
  });

  it("marks a chain with a missing link incomplete", () => {
    const t = new FrameTreeCache();
    t.onCommitted(nav(1, 0, -1, "https://news.example/"));
    t.onCommitted(nav(1, 9, 4, "https://cdn.example/")); // parent 4 never seen
    const a = t.ancestry(1, 9);
    expect(a?.complete).toBe(false);
  });

  it("about:blank frames inherit the nearest known ancestor host", () => {
    const t = new FrameTreeCache();
    t.onCommitted(nav(1, 0, -1, "https://news.example/"));
    t.onCommitted(nav(1, 3, 0, "about:blank"));
    t.onCommitted(nav(1, 5, 3, "https://x.example/"));
    expect(t.ancestry(1, 5)).toEqual({
      frameIds: [3, 0],
      hostnames: ["news.example", "news.example"],
      complete: true,
    });
  });

  it("onBeforeNavigate inserts only unknown frames; onCommitted overwrites and prunes descendants", () => {
    const t = new FrameTreeCache();
    t.onCommitted(nav(1, 0, -1, "https://news.example/"));
    t.onCommitted(nav(1, 4, 0, "https://ads.example/"));
    t.onCommitted(nav(1, 9, 4, "https://child.example/"));
    t.onBeforeNavigate(nav(1, 4, 0, "https://download.example/file"));
    expect(t.hostnameOf(1, 4)).toBe("ads.example");
    t.onBeforeNavigate(nav(1, 12, 0, "https://early.example/"));
    expect(t.hostnameOf(1, 12)).toBe("early.example");
    t.onCommitted(nav(1, 4, 0, "https://other.example/"));
    expect(t.hostnameOf(1, 4)).toBe("other.example");
    expect(t.ancestry(1, 9)).toBeUndefined();
    t.onCommitted(nav(1, 0, -1, "https://next.example/"));
    expect(t.ancestry(1, 4)).toBeUndefined();
    expect(t.hostnameOf(1, 0)).toBe("next.example");
  });

  it("keeps the onBeforeNavigate parent when onCommitted lacks parentFrameId", () => {
    const t = new FrameTreeCache();
    t.onCommitted(nav(1, 0, -1, "https://news.example/"));
    t.onBeforeNavigate(nav(1, 4, 0, "https://ads.example/"));
    t.onCommitted({ tabId: 1, frameId: 4, url: "https://ads.example/" });
    expect(t.ancestry(1, 4)?.complete).toBe(true);
  });

  it("is cleared on tab removal", () => {
    const t = new FrameTreeCache();
    t.onCommitted(nav(1, 0, -1, "https://news.example/"));
    t.onTabRemoved(1);
    expect(t.ancestry(1, 0)).toBeUndefined();
    expect(t.size).toEqual({ tabs: 0, frames: 0 });
  });

  it("evicts least recently used tabs beyond the tab limit", () => {
    const t = new FrameTreeCache(undefined, { maxTabs: 3, maxFramesPerTab: 10 });
    for (let tab = 1; tab <= 3; tab++) t.onCommitted(nav(tab, 0, -1, `https://t${tab}.example/`));
    t.ancestry(1, 0); // touch tab 1
    t.onCommitted(nav(4, 0, -1, "https://t4.example/"));
    expect(t.size.tabs).toBe(3);
    expect(t.ancestry(2, 0)).toBeUndefined();
    expect(t.ancestry(1, 0)).toBeDefined();
    expect(t.ancestry(4, 0)).toBeDefined();
  });

  it("evicts oldest frames beyond the per-tab limit but keeps the top frame", () => {
    const t = new FrameTreeCache(undefined, { maxTabs: 3, maxFramesPerTab: 5 });
    t.onCommitted(nav(1, 0, -1, "https://top.example/"));
    for (let f = 1; f <= 10; f++) t.onCommitted(nav(1, f, 0, `https://f${f}.example/`));
    expect(t.size.frames).toBe(5);
    expect(t.hostnameOf(1, 0)).toBe("top.example");
    expect(t.ancestry(1, 1)).toBeUndefined();
    expect(t.ancestry(1, 10)?.complete).toBe(true);
  });

  it("enforces default bounds of 200 tabs x 300 frames", () => {
    const t = new FrameTreeCache();
    for (let tab = 0; tab < 250; tab++) t.onCommitted(nav(tab, 0, -1, "https://a.example/"));
    for (let f = 1; f < 400; f++) t.onCommitted(nav(249, f, 0, "https://b.example/"));
    expect(t.size.tabs).toBe(200);
    expect(t.size.frames).toBeLessThanOrEqual(199 + 300);
  });

  it("refreshes lazily from getAllFrames, de-duplicating in-flight calls", async () => {
    const getAllFrames = vi.fn<FrameLookupApi["getAllFrames"]>(async () => [
      { frameId: 0, parentFrameId: -1, url: "https://news.example/" },
      { frameId: 7, parentFrameId: 0, url: "https://ads.example/x?token=abc" },
    ]);
    const t = new FrameTreeCache({ getAllFrames });
    expect(t.ancestry(5, 7)).toBeUndefined();
    const p1 = t.refresh(5);
    const p2 = t.refresh(5);
    await Promise.all([p1, p2]);
    expect(getAllFrames).toHaveBeenCalledTimes(1);
    expect(t.ancestry(5, 7)).toEqual({
      frameIds: [0],
      hostnames: ["news.example"],
      complete: true,
    });
    expect(t.hostnameOf(5, 7)).toBe("ads.example");
  });

  it("swallows getAllFrames failures", async () => {
    const t = new FrameTreeCache({
      getAllFrames: () => Promise.reject(new Error("No tab with id")),
    });
    await expect(t.refresh(3)).resolves.toBeUndefined();
    expect(t.ancestry(3, 0)).toBeUndefined();
  });

  it("rate-limits getAllFrames refreshes per tab", async () => {
    let now = 10_000;
    const getAllFrames = vi.fn<FrameLookupApi["getAllFrames"]>(async () => []);
    const t = new FrameTreeCache(
      { getAllFrames },
      { maxTabs: 10, maxFramesPerTab: 10 },
      () => now,
      1000,
    );
    await t.refresh(1);
    await t.refresh(1);
    now += 500;
    await t.refresh(1);
    expect(getAllFrames).toHaveBeenCalledTimes(1);
    await t.refresh(2); // other tabs are independent
    expect(getAllFrames).toHaveBeenCalledTimes(2);
    now += 600;
    await t.refresh(1);
    expect(getAllFrames).toHaveBeenCalledTimes(3);
    t.onTabRemoved(1);
    await t.refresh(1);
    expect(getAllFrames).toHaveBeenCalledTimes(4);
  });
});
