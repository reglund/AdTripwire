import { describe, expect, it } from "vitest";
import type { IndicatorSet, NormalizedEvent } from "@adtripwire/shared";
import { IndicatorMatcher, validateIndicatorSet } from "@adtripwire/indicators";
import {
  ALONGSIDE_MAX_ANCHORS_PER_HOST,
  ALONGSIDE_MAX_DAYS,
  ALONGSIDE_MAX_HOSTS,
  ALONGSIDE_WINDOW_MS,
  AlongsideStore,
  AlongsideTracker,
  listAlongside,
  listAlongsideAll,
} from "./alongside.js";
import { ev, T0 } from "./test-fixtures.js";

function record(id: string, indicator: string, type: string, cls: string) {
  return {
    id,
    indicator,
    indicatorType: type,
    source: "test",
    sourceUrl: "https://example.test/src",
    campaign: "synthetic",
    classification: cls,
    confidence: "high",
    firstReported: "2026-11-02",
    lastReviewed: "2026-11-02",
    enabled: true,
    role: "noas",
    notes: "t",
  };
}

const set = (() => {
  const v = validateIndicatorSet({
    meta: {
      id: "alongside-test",
      name: "t",
      version: "1.0.0",
      asOf: "2026-11-02",
      license: "Apache-2.0",
      synthetic: true,
      sources: [{ name: "t", url: "https://example.test/", published: "2026-11-02" }],
      description: "t",
    },
    indicators: [
      record("al-1", "noas.alpha.test", "hostname", "surveillance"),
      record("al-2", "c2.alpha.test", "hostname", "malicious"),
      record("al-3", "ctx-ads.test", "domain", "contextual"),
    ],
  });
  if (!v.ok) throw new Error(v.errors.join("; "));
  return v.set as IndicatorSet;
})();
const matcher = new IndicatorMatcher([set]);

let n = 0;
interface P {
  host: string;
  frame?: number;
  anc?: number[];
  parent?: number;
  tab?: number;
  t?: number;
  type?: NormalizedEvent["resourceType"];
  req?: string;
  path?: string;
  /** Top-document hostname; default a fixed publisher; null omits it. */
  top?: string | null;
}
function mk(p: P): NormalizedEvent {
  const frame = p.frame ?? 3;
  const base = ev({
    eventId: `e${n++}`,
    timestamp: T0 + (p.t ?? 0),
    tabId: p.tab ?? 1,
    resourceType: p.type ?? "script",
    destination: {
      scheme: "https",
      hostname: p.host,
      pathPattern: p.path ?? "/x",
      queryParamNames: [],
      redacted: false,
    },
    frameContext: {
      frameId: frame,
      parentFrameId: p.parent ?? 0,
      ancestorHostnames: [],
      ancestorFrameIds: p.anc ?? (frame > 0 ? [0] : []),
      depth: frame > 0 ? 1 : 0,
      thirdParty: true,
    },
  });
  if (p.top !== null) base.frameContext.topHostname = p.top ?? "news.publisher.test";
  if (p.req !== undefined) base.requestId = p.req;
  return base;
}

function feed(tracker: AlongsideTracker, events: NormalizedEvent[]): void {
  const seen: NormalizedEvent[] = [];
  for (const e of events) {
    seen.push(e);
    tracker.observe(e, () => seen);
  }
}

const mkTracker = () => new AlongsideTracker({ matcher: () => matcher });
const empty = { distinctDays: () => 0 };

describe("AlongsideTracker", () => {
  it("records a candidate in the same ad frame as an indicator anchor (frame scope), late creative", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 3, t: 0, path: "/getAd" }),
      mk({ host: "creative.cdn.test", frame: 3, t: 5000 }),
    ]);
    const rec = t.store.get("creative.cdn.test");
    expect(rec?.frameDays).toEqual(["2025-11-01"]);
    expect(rec?.pageDays).toEqual([]);
    expect(rec?.anchors).toEqual(["al-1"]);
    expect(t.store.totals).toMatchObject({ anchorsSeen: 1, frameAnchors: 1, pageAnchors: 0 });
  });

  it("scans the window backwards when the anchor opens after the candidate", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "early.cdn.test", frame: 3, t: 0 }),
      mk({ host: "noas.alpha.test", frame: 3, t: 4000, path: "/getAd" }),
    ]);
    expect(t.store.get("early.cdn.test")?.frameDays.length).toBe(1);
  });

  it("matches nested frames under the same ad frame via ancestry", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 5, anc: [2, 0], t: 0 }),
      mk({ host: "inner.cdn.test", frame: 7, anc: [5, 2, 0], t: 100 }),
      mk({ host: "sibling.cdn.test", frame: 6, anc: [2, 0], t: 200 }),
    ]);
    expect(t.store.get("inner.cdn.test")?.frameDays.length).toBe(1);
    expect(t.store.get("sibling.cdn.test")?.frameDays.length).toBe(1);
  });

  it("records an anchor in the top document with page scope only", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 0, anc: [], t: 0 }),
      mk({ host: "lib.cdn.test", frame: 0, anc: [], t: 100 }),
    ]);
    const rec = t.store.get("lib.cdn.test");
    expect(rec?.pageDays.length).toBe(1);
    expect(rec?.frameDays).toEqual([]);
    expect(t.store.totals).toMatchObject({ pageAnchors: 1, frameAnchors: 0 });
  });

  it("does not let a sub_frame anchor claim top-document events", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 4, parent: 0, type: "sub_frame", t: 0 }),
      mk({ host: "page-wide.cdn.test", frame: 0, anc: [], t: 100 }),
    ]);
    expect(t.store.get("page-wide.cdn.test")).toBeUndefined();
  });

  it("opens no anchor without an indicator match (heuristic redirect chain only)", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "ads.mainstream.test", frame: 3, t: 0 }),
      mk({ host: "csync.mainstream.test", frame: 3, t: 100 }),
      mk({ host: "other.mainstream.test", frame: 3, t: 200 }),
    ]);
    expect(t.store.size).toBe(0);
    expect(t.store.totals.anchorsSeen).toBe(0);
    expect(t.openAnchors).toBe(0);
  });

  it("a contextual indicator never anchors", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "x.ctx-ads.test", frame: 3, t: 0 }),
      mk({ host: "creative.cdn.test", frame: 3, t: 100 }),
    ]);
    expect(t.store.size).toBe(0);
    expect(t.store.totals.anchorsSeen).toBe(0);
  });

  it("does not record a host in another tab at the same time", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 3, tab: 1, t: 0 }),
      mk({ host: "creative.cdn.test", frame: 3, tab: 2, t: 100 }),
    ]);
    expect(t.store.size).toBe(0);
  });

  it("does not record a host in an unrelated sibling frame", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 3, anc: [0], t: 0 }),
      mk({ host: "other-ad.cdn.test", frame: 9, anc: [0], t: 100 }),
    ]);
    expect(t.store.size).toBe(0);
  });

  it("does not record lineage 'unknown' (same tab, no ancestry, different frame)", () => {
    const t = mkTracker();
    const a = mk({ host: "noas.alpha.test", frame: 3, t: 0 });
    const c = mk({ host: "somewhere.cdn.test", frame: 8, t: 100 });
    delete a.frameContext.ancestorFrameIds;
    delete c.frameContext.ancestorFrameIds;
    feed(t, [a, c]);
    expect(t.store.size).toBe(0);
  });

  it("still records same-frame hosts without ancestry (Chromium-like)", () => {
    const t = mkTracker();
    const a = mk({ host: "noas.alpha.test", frame: 3, t: 0 });
    const c = mk({ host: "same-frame.cdn.test", frame: 3, t: 100 });
    delete a.frameContext.ancestorFrameIds;
    delete c.frameContext.ancestorFrameIds;
    feed(t, [a, c]);
    expect(t.store.get("same-frame.cdn.test")?.frameDays.length).toBe(1);
  });

  it("excludes indicator hosts, the anchor host, IP literals and localhost as candidates", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 3, t: 0 }),
      mk({ host: "c2.alpha.test", frame: 3, t: 10 }),
      mk({ host: "noas.alpha.test", frame: 3, t: 20 }),
      mk({ host: "sub.ctx-ads.test", frame: 3, t: 30 }),
      mk({ host: "192.0.2.7", frame: 3, t: 40 }),
      mk({ host: "[2001:db8::1]", frame: 3, t: 50 }),
      mk({ host: "localhost", frame: 3, t: 60 }),
      mk({ host: "dev.localhost", frame: 3, t: 70 }),
    ]);
    expect(t.store.size).toBe(0);
  });

  it("ignores candidates outside the window", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 3, t: 0 }),
      mk({ host: "late.cdn.test", frame: 3, t: ALONGSIDE_WINDOW_MS + 1 }),
    ]);
    expect(t.store.size).toBe(0);
    expect(t.openAnchors).toBe(0);
  });

  it("bounds open anchors", () => {
    const t = new AlongsideTracker({ matcher: () => matcher, maxOpenAnchors: 3 });
    for (let i = 1; i <= 10; i++)
      feed(t, [mk({ host: "noas.alpha.test", frame: i, anc: [0], t: i })]);
    expect(t.openAnchors).toBe(3);
    expect(t.store.totals.anchorsSeen).toBe(10);
  });

  it("opens one anchor per (indicator, tab, frame) while it stays open", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 3, t: 0 }),
      mk({ host: "noas.alpha.test", frame: 3, t: 1000 }),
    ]);
    expect(t.store.totals.anchorsSeen).toBe(1);
  });

  it("ignores page signals", () => {
    const t = mkTracker();
    const sig = mk({ host: "noas.alpha.test", frame: 3, t: 0 });
    sig.eventType = "page_signal";
    feed(t, [sig, mk({ host: "creative.cdn.test", frame: 3, t: 10 })]);
    expect(t.store.size).toBe(0);
  });

  it("uses the matcher current at call time", () => {
    let m = new IndicatorMatcher([]);
    const t = new AlongsideTracker({ matcher: () => m });
    feed(t, [mk({ host: "noas.alpha.test", frame: 3, t: 0 })]);
    expect(t.store.totals.anchorsSeen).toBe(0);
    m = matcher;
    feed(t, [mk({ host: "noas.alpha.test", frame: 3, t: 10 })]);
    expect(t.store.totals.anchorsSeen).toBe(1);
  });
});

describe("AlongsideTracker page-site isolation", () => {
  it("never records the page's own site: same-site wrapper iframe load", () => {
    const t = mkTracker();
    feed(t, [
      // Wrapper iframe P (frame 2, same site as the page) loads, then the ad frame A (5) inside it.
      mk({ host: "news.publisher.test", frame: 2, parent: 0, type: "sub_frame", t: 0 }),
      mk({ host: "ads.adtech.test", frame: 5, anc: [2, 0], parent: 2, type: "sub_frame", t: 10 }),
      mk({ host: "noas.alpha.test", frame: 5, anc: [2, 0], t: 20 }),
      mk({ host: "creative.cdn.test", frame: 5, anc: [2, 0], t: 30 }),
      mk({ host: "www.news.publisher.test", frame: 5, anc: [2, 0], t: 40 }),
    ]);
    expect(t.store.get("news.publisher.test")).toBeUndefined();
    expect(t.store.get("www.news.publisher.test")).toBeUndefined();
    expect(t.store.get("creative.cdn.test")?.frameDays.length).toBe(1);
    // The ad-tech host that is not the page's site stays (sister hosts are not excluded).
    expect(t.store.get("ads.adtech.test")?.frameDays.length).toBe(1);
  });

  it("page-scope anchor does not record same-site iframes or first-party requests", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 0, anc: [], t: 0 }),
      mk({ host: "news.publisher.test", frame: 4, parent: 0, type: "sub_frame", t: 10 }),
      mk({ host: "news.publisher.test", frame: 0, anc: [], path: "/getAd", t: 20 }),
      mk({ host: "lib.cdn.test", frame: 0, anc: [], t: 30 }),
    ]);
    expect(t.store.get("news.publisher.test")).toBeUndefined();
    expect(t.store.get("lib.cdn.test")?.pageDays.length).toBe(1);
  });

  it("does not record first-party requests made inside the ad frame", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 3, t: 0 }),
      mk({ host: "news.publisher.test", frame: 3, t: 10 }),
    ]);
    expect(t.store.size).toBe(0);
  });

  it("navigation closes the tab's anchors, so the next site is not credited to them", () => {
    const t = mkTracker();
    feed(t, [mk({ host: "noas.alpha.test", frame: 3, t: 0, top: "site-a.test" })]);
    expect(t.openAnchors).toBe(1);
    t.onNavigation(1, T0 + 5000);
    expect(t.openAnchors).toBe(0);
    feed(t, [mk({ host: "creative.cdn.test", frame: 3, t: 6000, top: "site-b.test" })]);
    expect(t.store.size).toBe(0);
  });

  it("the backward scan ignores events from before the tab's navigation", () => {
    const t = mkTracker();
    // Same page site on both sides, so only the navigation time can exclude the earlier event.
    const earlier = mk({ host: "old-site.cdn.test", frame: 3, t: 0, top: "site-a.test" });
    t.onNavigation(1, T0 + 1000);
    const anchor = mk({ host: "noas.alpha.test", frame: 3, t: 2000, top: "site-a.test" });
    t.observe(anchor, () => [earlier, anchor]);
    expect(t.store.size).toBe(0);
    expect(t.store.totals.anchorsSeen).toBe(1);
  });

  it("a replacement tracker inherits navigation times (snapshot restore after startup)", () => {
    const before = mkTracker();
    const earlier = mk({ host: "old-site.cdn.test", frame: 3, t: 0, top: "site-a.test" });
    before.onNavigation(1, T0 + 1000);
    const t = mkTracker();
    t.inheritNavigation(before);
    const anchor = mk({ host: "noas.alpha.test", frame: 3, t: 2000, top: "site-a.test" });
    t.observe(anchor, () => [earlier, anchor]);
    expect(t.store.size).toBe(0);
  });

  it("another tab's anchors survive a navigation elsewhere", () => {
    const t = mkTracker();
    feed(t, [mk({ host: "noas.alpha.test", frame: 3, tab: 2, t: 0 })]);
    t.onNavigation(1, 1000);
    expect(t.openAnchors).toBe(1);
  });

  it("rejects a candidate whose page site differs from the anchor's (no navigation seen)", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 3, t: 0, top: "site-a.test" }),
      mk({ host: "creative.cdn.test", frame: 3, t: 100, top: "site-b.test" }),
    ]);
    expect(t.store.size).toBe(0);
  });

  it("fails closed without a top hostname on the anchor; candidate without one uses the anchor's", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 3, t: 0, top: null }),
      mk({ host: "creative.cdn.test", frame: 3, t: 100 }),
    ]);
    expect(t.store.size).toBe(0);
    expect(t.store.totals.anchorsSeen).toBe(0);
    const u = mkTracker();
    feed(u, [
      mk({ host: "noas.alpha.test", frame: 3, t: 0 }),
      mk({ host: "creative.cdn.test", frame: 3, t: 100, top: null }),
    ]);
    expect(u.store.get("creative.cdn.test")?.frameDays.length).toBe(1);
  });

  it("anchors only on a current indicator (not expired, not yet valid)", () => {
    const future = {
      ...record("al-9", "later.alpha.test", "hostname", "surveillance"),
      validFrom: "2099-01-01",
    };
    const old = {
      ...record("al-8", "old.alpha.test", "hostname", "surveillance"),
      validTo: "2000-01-01",
    };
    const v = validateIndicatorSet({ ...set, indicators: [future, old] } as unknown);
    if (!v.ok) throw new Error(v.errors.join("; "));
    const t = new AlongsideTracker({
      matcher: () => new IndicatorMatcher([v.set as IndicatorSet]),
    });
    feed(t, [
      mk({ host: "later.alpha.test", frame: 3, t: 0 }),
      mk({ host: "old.alpha.test", frame: 4, t: 0 }),
    ]);
    expect(t.store.totals.anchorsSeen).toBe(0);
  });
});

describe("AlongsideStore", () => {
  it("bounds hosts (LRU, page-only first), days and anchors", () => {
    const s = new AlongsideStore();
    s.record("keeper.test", "al-1", "frame", "2026-01-01");
    for (let i = 0; i < ALONGSIDE_MAX_HOSTS + 20; i++)
      s.record(`h${i}.test`, "al-1", "page", "2026-01-01");
    expect(s.size).toBe(ALONGSIDE_MAX_HOSTS);
    expect(s.get("keeper.test")).toBeDefined();
    for (let d = 1; d <= 90; d++)
      s.record(
        "many.test",
        `id-${d}`,
        "frame",
        `2026-${d <= 31 ? "01" : d <= 59 ? "02" : "03"}-${String(((d - 1) % 28) + 1).padStart(2, "0")}`,
      );
    const r = s.get("many.test");
    expect(r?.days.length).toBeLessThanOrEqual(ALONGSIDE_MAX_DAYS);
    expect(r?.anchors.length).toBe(ALONGSIDE_MAX_ANCHORS_PER_HOST);
  });

  it("round-trips through JSON", () => {
    const s = new AlongsideStore();
    s.noteAnchor("frame", "2026-01-01");
    s.record("a.test", "al-1", "frame", "2026-01-01");
    s.record("a.test", "al-2", "page", "2026-01-02");
    const copy = AlongsideStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
    expect(copy.toJSON()).toEqual(s.toJSON());
  });

  it("fromJSON survives garbage", () => {
    for (const g of [
      null,
      undefined,
      42,
      "x",
      [],
      {},
      { hosts: "nope" },
      { hosts: [null, 1, ["a"], ["/path?x=1", {}], ["ok.test", null], ["ok.test", { days: "x" }]] },
      { totals: { anchorsSeen: "NaN", frameAnchors: -5, anchorDays: [1, "bad"] }, hosts: [] },
      {
        hosts: [
          ["a.test", { days: ["2026-01-01"], anchors: [{}, "al-1", "bad id!"], frameDays: 7 }],
        ],
      },
    ]) {
      const s = AlongsideStore.fromJSON(g);
      expect(() => JSON.stringify(s.toJSON())).not.toThrow();
    }
    const s = AlongsideStore.fromJSON({
      hosts: [["a.test", { days: ["2026-01-01"], anchors: [{}, "al-1", "bad id!"], frameDays: 7 }]],
    });
    expect(s.get("a.test")?.anchors).toEqual(["al-1"]);
    expect(AlongsideStore.fromJSON({ hosts: [["a/b?c=d", { days: ["2026-01-01"] }]] }).size).toBe(
      0,
    );
  });

  it("fromJSON caps oversized input", () => {
    const hosts = Array.from({ length: ALONGSIDE_MAX_HOSTS + 50 }, (_, i) => [
      `h${i}.test`,
      { days: ["2026-01-01"], anchors: [], frameDays: ["2026-01-01"], pageDays: [] },
    ]);
    expect(AlongsideStore.fromJSON({ hosts }).size).toBe(ALONGSIDE_MAX_HOSTS);
  });

  it("serialised store contains only hostnames, ids and day keys (privacy)", () => {
    const t = mkTracker();
    feed(t, [
      mk({ host: "noas.alpha.test", frame: 3, t: 0, path: "/getAd" }),
      mk({ host: "creative.cdn.test", frame: 3, t: 100, path: "/a/b/c" }),
    ]);
    const json = JSON.stringify(t.store.toJSON());
    const strings = [...json.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
    for (const sv of strings) {
      expect(sv).not.toMatch(/[/?=#:]/);
    }
    expect(json).not.toContain("getAd");
    expect(json).not.toContain("/a/b/c");
  });
});

describe("listAlongside", () => {
  function storeWith(
    host: string,
    days: number,
    scope: "frame" | "page" = "frame",
  ): AlongsideStore {
    const s = new AlongsideStore();
    for (let d = 1; d <= days; d++)
      s.record(host, "al-1", scope, `2026-01-${String(d).padStart(2, "0")}`);
    return s;
  }

  it("lists a host seen alongside on most of the days it was seen", () => {
    const s = storeWith("creative.cdn.test", 3);
    const out = listAlongside(s, { distinctDays: () => 4 });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      hostname: "creative.cdn.test",
      alongsideDays: 3,
      seenDays: 4,
      share: 0.75,
      anchors: ["al-1"],
      frameDays: 3,
      pageDays: 0,
      lastSeen: "2026-01-03",
    });
  });

  it("does not list a single alongside day (minimum 2)", () => {
    const out = listAlongside(storeWith("creative.cdn.test", 1), empty);
    expect(out.rows).toEqual([]);
    expect(out.totals.frameHosts).toBe(1);
  });

  it("ranks by share, so a mainstream host with 2 of 40 days sinks below 2 of 2", () => {
    const s = new AlongsideStore();
    for (const d of ["2026-01-01", "2026-01-02"]) {
      s.record("ads.mainstream.test", "al-1", "frame", d);
      s.record("lead.rare.test", "al-1", "frame", d);
    }
    const out = listAlongside(s, {
      distinctDays: (k) => (k === "mainstream.test" ? 40 : 2),
    });
    expect(out.rows.map((r) => r.hostname)).toEqual(["lead.rare.test", "ads.mainstream.test"]);
    expect(out.rows[1]!.share).toBeCloseTo(0.05);
  });

  it("a mainstream host with 1 alongside day of 40 seen is not listed", () => {
    const out = listAlongside(storeWith("ads.mainstream.test", 1), { distinctDays: () => 40 });
    expect(out.rows).toEqual([]);
  });

  it("seenDays is never below alongsideDays (baseline gap)", () => {
    const out = listAlongside(storeWith("a.test", 2), empty);
    expect(out.rows[0]).toMatchObject({ seenDays: 2, share: 1 });
  });

  it("reports page-scope-only hosts separately and never ranks them", () => {
    const s = storeWith("page.cdn.test", 3, "page");
    s.noteAnchor("page", "2026-01-01");
    const out = listAlongside(s, empty);
    expect(out.rows).toEqual([]);
    expect(out.pageOnly.map((r) => r.hostname)).toEqual(["page.cdn.test"]);
    expect(out.pageOnly[0]).toMatchObject({ alongsideDays: 0, pageDays: 3 });
    expect(out.totals).toMatchObject({
      anchorsSeen: 1,
      pageAnchors: 1,
      frameAnchors: 0,
      anchorDays: 1,
    });
  });

  it("explains an empty store with zero totals", () => {
    const out = listAlongside(new AlongsideStore(), empty);
    expect(out).toEqual({
      rows: [],
      pageOnly: [],
      totals: {
        anchorsSeen: 0,
        frameAnchors: 0,
        pageAnchors: 0,
        anchorDays: 0,
        hostsTracked: 0,
        frameHosts: 0,
        minAlongsideDays: 2,
      },
    });
  });
});

describe("hit counters and the all-hosts view", () => {
  it("counts a repeat sighting on the same day that the day sets cannot show", () => {
    const s = new AlongsideStore();
    s.record("a.test", "al-1", "frame", "2026-01-01");
    const before = s.get("a.test");
    expect(before?.frameHits).toBe(1);
    expect(s.record("a.test", "al-1", "frame", "2026-01-01")).toBe(true);
    expect(s.get("a.test")?.frameDays).toEqual(["2026-01-01"]);
    expect(s.get("a.test")?.frameHits).toBe(2);
    s.record("a.test", "al-1", "page", "2026-01-01");
    expect(s.get("a.test")?.pageHits).toBe(1);
  });

  it("rejects an invalid hostname without counting", () => {
    const s = new AlongsideStore();
    expect(s.record("bad host/x", "al-1", "frame", "2026-01-01")).toBe(false);
    expect(s.size).toBe(0);
  });

  it("round-trips the counters and loads an old snapshot without them as zero", () => {
    const s = new AlongsideStore();
    s.record("a.test", "al-1", "frame", "2026-01-01");
    s.record("a.test", "al-1", "frame", "2026-01-01");
    expect(
      AlongsideStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON()))).get("a.test"),
    ).toMatchObject({ frameHits: 2, pageHits: 0 });
    const old = {
      version: 1,
      totals: { anchorsSeen: 1, frameAnchors: 1, pageAnchors: 0, anchorDays: ["2026-01-01"] },
      hosts: [
        [
          "old.test",
          { days: ["2026-01-01"], anchors: ["al-1"], frameDays: ["2026-01-01"], pageDays: [] },
        ],
        [
          "junk.test",
          {
            days: ["2026-01-01"],
            anchors: [],
            frameDays: ["2026-01-01"],
            pageDays: [],
            frameHits: -5,
            pageHits: "x",
          },
        ],
      ],
    };
    const loaded = AlongsideStore.fromJSON(old);
    expect(loaded.get("old.test")).toMatchObject({ frameHits: 0, pageHits: 0 });
    expect(loaded.get("junk.test")).toMatchObject({ frameHits: 0, pageHits: 0 });
  });

  it("lists every tracked host, including ones the ranking leaves out", () => {
    const s = new AlongsideStore();
    s.record("once.test", "al-1", "frame", "2026-01-01");
    s.record("page.test", "al-1", "page", "2026-01-01");
    const ranked = listAlongside(s, empty);
    expect(ranked.rows).toEqual([]);
    const all = listAlongsideAll(s, empty);
    expect(all.rows).toEqual([]);
    expect(all.hosts.map((h) => [h.hostname, h.frameHits, h.pageHits])).toEqual([
      ["once.test", 1, 0],
      ["page.test", 0, 1],
    ]);
    expect(JSON.stringify(all)).not.toMatch(/[/?=]/);
  });
});
