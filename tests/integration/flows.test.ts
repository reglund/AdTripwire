/**
 * "How each finding flowed": frame origin in the harness recorder, flow building and rendering
 * (scripts/lib/documented-hosts.mjs, scripts/lib/flows.mjs, scripts/observatory-build.mjs).
 */
import { describe, expect, it } from "vitest";
import {
  VIA_MAX,
  documentedMatcher,
  frameOrigin,
  outcomeRecorder,
  stageOf,
} from "../../scripts/lib/documented-hosts.mjs";
import {
  FLOWS_MAX,
  buildFlows,
  frameLabel,
  outcomeClass,
  reading,
} from "../../scripts/lib/flows.mjs";
import { loadRuns } from "../../scripts/lib/exposure-runs.mjs";
import { buildIndex, renderHtml } from "../../scripts/observatory-build.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const IND = [
  {
    id: "t-1",
    indicator: "sync.tracker.test",
    indicatorType: "domain",
    classification: "surveillance",
    role: "tracking",
    enabled: true,
  },
  {
    id: "n-1",
    indicator: "noas.test",
    indicatorType: "domain",
    classification: "surveillance",
    role: "noas",
    enabled: true,
  },
  {
    id: "c-1",
    indicator: "c2.bad.test",
    indicatorType: "hostname",
    classification: "malicious",
    role: "c2",
    enabled: true,
  },
  {
    id: "s-1",
    indicator: "stage.cdn.test",
    indicatorType: "hostname",
    classification: "surveillance",
    role: "staging",
    enabled: true,
  },
];
const NOW = Date.parse("2026-11-09T00:00:00Z");

type Fr = { url: () => string; parentFrame: () => Fr | null };
const frame = (url: string, parent: Fr | null = null): Fr => ({
  url: () => url,
  parentFrame: () => parent,
});

describe("frameOrigin", () => {
  const main = frame("https://www.site.test/article");
  it("tells the page's own document from subframes, using the nearest addressed ancestor", () => {
    const ad = frame("https://ads.yastatic.test/frame.html?uid=SECRET", main);
    const blank = frame("about:blank", ad);
    expect(frameOrigin(main, main)).toEqual({ top: true });
    expect(frameOrigin(ad, main)).toEqual({ host: "ads.yastatic.test" });
    expect(frameOrigin(blank, main)).toEqual({ host: "ads.yastatic.test" });
    expect(frameOrigin(frame("about:blank", main), main)).toEqual({ host: "www.site.test" });
    expect(frameOrigin(null, main)).toBeNull();
    expect(frameOrigin(frame("about:blank"), main)).toBeNull();
  });
});

describe("outcomeRecorder via and fromTop", () => {
  const m = documentedMatcher({ indicators: IND, now: NOW });
  it("records frame hostnames and top-document requests, only for documented hosts, lazily", () => {
    const r = outcomeRecorder(m);
    let calls = 0;
    const lazy = (o: unknown) => () => {
      calls += 1;
      return o;
    };
    r.request("https://cdn.other.test/x.js", lazy({ host: "nope.test" }));
    expect(calls).toBe(0);
    r.request("https://a.sync.tracker.test/s?id=SECRET", lazy({ host: "Ads.Yastatic.test" }));
    r.request("https://a.sync.tracker.test/s", { top: true });
    r.request("https://a.sync.tracker.test/s", null);
    for (let i = 0; i < VIA_MAX + 3; i++)
      r.request("https://c2.bad.test/", { host: `f${i}.frames.test` });
    const rows = r.rows();
    expect(rows[0]).toMatchObject({
      host: "a.sync.tracker.test",
      requests: 3,
      via: ["ads.yastatic.test"],
      fromTop: 1,
    });
    expect(rows[1].via).toHaveLength(VIA_MAX);
    // origin() records the frame when the request ends, without counting another request.
    const late = outcomeRecorder(m);
    late.request("https://x.noas.test/getAd");
    late.origin("https://x.noas.test/getAd", () => ({ host: "frame.ads.test" }));
    late.origin("https://cdn.other.test/x.js", () => {
      throw new Error("not looked up for undocumented hosts");
    });
    expect(late.rows()).toEqual([
      expect.objectContaining({ host: "x.noas.test", requests: 1, via: ["frame.ads.test"] }),
    ]);
    expect(rows[1].fromTop).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain("SECRET");
  });
});

describe("outcomeClass and reading", () => {
  const o = (x: object) => ({ requests: 1, statuses: {}, failures: {}, ...x });
  it("classifies outcomes, most telling first", () => {
    expect(outcomeClass(undefined)).toBe("not-recorded");
    expect(outcomeClass(o({ statuses: { "200": 1 }, maxBytes: 900 }))).toBe("content");
    expect(outcomeClass(o({ statuses: { "200": 1 } }))).toBe("answered");
    expect(outcomeClass(o({ statuses: { "204": 1 } }))).toBe("empty");
    expect(outcomeClass(o({ statuses: { "200": 1 }, maxBytes: 0 }))).toBe("empty");
    expect(outcomeClass(o({ statuses: { "302": 1 }, maxBytes: 0 }))).toBe("redirect");
    expect(outcomeClass(o({ statuses: { "404": 1 } }))).toBe("http-error");
    expect(outcomeClass(o({ failures: { "net::ERR_NAME_NOT_RESOLVED": 1 } }))).toBe("failed");
    expect(outcomeClass(o({}))).toBe("no-end");
  });
  it("marks only answered selection, delivery and spyware contacts for a closer look", () => {
    expect(reading("tracking", "content").attention).toBe(false);
    expect(reading("selection", "empty").attention).toBe(false);
    expect(reading("selection", "content").attention).toBe(true);
    expect(reading("selection", "failed").attention).toBe(false);
    expect(reading("delivery", "answered").attention).toBe(true);
    expect(reading("delivery", "failed").attention).toBe(false);
    expect(reading("spyware", "failed").attention).toBe(true);
    for (const st of ["tracking", "selection", "delivery", "spyware"])
      for (const c of ["content", "empty", "failed", "not-recorded"])
        expect(reading(st, c).text).not.toMatch(/\b(safe|clean|infected|spied|targeted)\b/i);
  });
  it("maps roles to stages", () => {
    expect(stageOf("operator-infrastructure", "surveillance")).toBe("tracking");
    expect(stageOf("noas", "surveillance")).toBe("selection");
    expect(stageOf("staging", "surveillance")).toBe("delivery");
    expect(stageOf("candiru-attributed", "malicious")).toBe("spyware");
    expect(stageOf("something-new", "malicious")).toBe("spyware");
  });
  it("labels frames relative to the site", () => {
    expect(frameLabel("www.site.test", undefined).title).toBe("Frame not recorded");
    expect(
      frameLabel("www.site.test", o({ via: ["ads.yastatic.test", "x.site.test"], fromTop: 2 })),
    ).toEqual({
      title: "Ad frame and frame on the site's own domain and the page itself",
      hosts: ["ads.yastatic.test"],
    });
  });
});

describe("buildFlows", () => {
  const c = (date: string, site: string, hostnames: string[], repeat = false) => ({
    date,
    rig: "rig-1",
    variant: "chromium",
    slug: "chromium",
    site,
    ruleId: "known_infra.surveillance_host",
    severity: "suspicious",
    hostnames,
    ...(repeat ? { repeat: true } : {}),
  });
  const out = (date: string, site: string, host: string, indicator: string, x: object) => ({
    date,
    rig: "rig-1",
    variant: "chromium",
    site,
    host,
    indicator,
    requests: 1,
    statuses: {},
    failures: {},
    ...x,
  });
  it("joins contacts and outcomes, groups identical chains over days, newest first", () => {
    const flows = buildFlows(
      [
        c("2026-11-07", "news.test", ["events.sync.tracker.test", "unrelated.example"]),
        c("2026-11-09", "news.test", ["events.sync.tracker.test"], true),
        c("2026-11-09", "other.test", ["c2.bad.test"]),
      ],
      [
        out("2026-11-09", "news.test", "events.sync.tracker.test", "t-1", {
          failures: { "net::ERR_NAME_NOT_RESOLVED": 1 },
          via: ["ads.yastatic.test"],
        }),
        out("2026-11-10", "news.test", "events.sync.tracker.test", "t-1", {
          failures: { NS_ERROR_UNKNOWN_HOST: 1 },
          via: ["ads.yastatic.test"],
        }),
        out("2026-11-10", "x.test", "a.noas.test", "n-1", {
          statuses: { "200": 1 },
          maxBytes: 4200,
          fromTop: 1,
        }),
      ],
      { indicators: IND },
    );
    expect(flows.map((f) => [f.site, f.host, f.outcomeClass, f.dates])).toEqual([
      ["news.test", "events.sync.tracker.test", "failed", ["2026-11-09", "2026-11-10"]],
      ["x.test", "a.noas.test", "content", ["2026-11-10"]],
      ["other.test", "c2.bad.test", "not-recorded", ["2026-11-09"]],
      ["news.test", "events.sync.tracker.test", "not-recorded", ["2026-11-07"]],
    ]);
    expect(flows[0]).toMatchObject({
      stage: "tracking",
      role: "tracking",
      repeat: true,
      frame: { title: "Ad frame", hosts: ["ads.yastatic.test"] },
      reading: { attention: false },
    });
    expect(flows[0].outcome).toMatch(/name no longer resolves/);
    expect(flows[1]).toMatchObject({
      stage: "selection",
      frame: { title: "The page itself", hosts: [] },
      reading: { attention: true },
    });
    expect(flows[2]).toMatchObject({ stage: "spyware", reading: { attention: true } });
  });
  it("caps the number of groups", () => {
    const many = Array.from({ length: FLOWS_MAX + 5 }, (_, i) =>
      c("2026-11-09", `s${i}.test`, ["sync.tracker.test"]),
    );
    expect(buildFlows(many, [], { indicators: IND })).toHaveLength(FLOWS_MAX);
  });
});

describe("flows in runs, index and page", () => {
  const run = (row: object) => ({
    date: "2026-11-09",
    browser: "chromium",
    variant: "chromium",
    results: [{ site: "news.test", detections: [], ...row }],
  });
  const OK = {
    host: "events.sync.tracker.test",
    indicator: "t-1",
    requests: 1,
    statuses: {},
    failures: { "net::ERR_NAME_NOT_RESOLVED": 1 },
  };
  it("validates via and fromTop", () => {
    const dir = mkdtempSync(join(tmpdir(), "adtripwire-flows-"));
    try {
      const put = (f: string, o: object) =>
        writeFileSync(join(dir, f), JSON.stringify(run({ documentedOutcomes: [o] })));
      put("ok.json", { ...OK, via: ["ads.yastatic.test"], fromTop: 2 });
      put("via-url.json", { ...OK, via: ["https://x.test/a"] });
      put("via-many.json", { ...OK, via: Array.from({ length: VIA_MAX + 1 }, () => "a.test") });
      put("top-zero.json", { ...OK, fromTop: 0 });
      expect(loadRuns(dir).map((r: { file: string }) => r.file)).toEqual(["ok.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("draws the chain and the stage overview, escaped and without verdict words", () => {
    const r = {
      file: "x.json",
      ...run({
        site: "news<x>.test",
        detections: [
          {
            ruleId: "known_infra.surveillance_host",
            severity: "suspicious",
            hostnames: ["events.sync.tracker.test"],
          },
        ],
        documentedOutcomes: [{ ...OK, via: ["ads.yastatic.test"] }],
      }),
    };
    const index = buildIndex([r], { generatedAt: "2026-11-09T12:00:00.000Z", indicators: IND });
    expect(index.flows).toHaveLength(1);
    expect(index.outcomes[0].via).toEqual(["ads.yastatic.test"]);
    const html = renderHtml(index);
    expect(html).toContain("How each finding flowed");
    expect(html).toContain("2. Tracking and ID sync");
    expect(html).toContain("1 finding(s) in this period");
    expect(html).toContain("ads.yastatic.test");
    expect(html).toContain("the name no longer resolves");
    expect(html).toContain("news&lt;x&gt;.test");
    expect(html).not.toContain("news<x>");
    expect(html).not.toMatch(/\b(safe|clean|infected|spied)\b/i);
    expect(renderHtml(buildIndex([], { indicators: IND }))).toContain("No finding to draw");
  });
});
