import { describe, expect, it } from "vitest";
import type { AlongsideListing, AlongsideRow } from "@adtripwire/correlation";
import type { IndicatorSet } from "@adtripwire/shared";
import { SEEN_ALONGSIDE_DISCLAIMER } from "@adtripwire/privacy";
import { exportResearch, type ResearchExportInput } from "./research-export.js";

const set: IndicatorSet = {
  meta: {
    id: "syn-set",
    name: "Synthetic set",
    version: "2026.11.07",
    asOf: "2026-11-07",
    license: "CC0-1.0",
    synthetic: false,
    sources: [
      { name: "Synthetic Lab", url: "https://report.example.test", published: "2026-10-15" },
    ],
  },
  indicators: [
    {
      id: "s-1",
      indicator: "tracker-one.test",
      indicatorType: "hostname",
      classification: "surveillance",
      confidence: "high",
      campaign: "synthetic",
      source: "Synthetic Lab",
      sourceUrl: "https://report.example.test/a",
      firstReported: "2026-10-15",
      lastReviewed: "2026-10-15",
      enabled: true,
    },
  ],
} as unknown as IndicatorSet;

const row = (hostname: string, over: Partial<AlongsideRow> = {}): AlongsideRow => ({
  hostname,
  alongsideDays: 3,
  seenDays: 4,
  share: 0.75,
  anchors: ["s-1"],
  frameDays: 3,
  pageDays: 1,
  lastSeen: "2026-11-05",
  ...over,
});

const listing: AlongsideListing = {
  rows: [row("creative.synthetic-cdn.test")],
  pageOnly: [row("pageonly.synthetic-cdn.test", { alongsideDays: 0, frameDays: 0 })],
  totals: {
    anchorsSeen: 5,
    frameAnchors: 3,
    pageAnchors: 2,
    anchorDays: 2,
    hostsTracked: 2,
    frameHosts: 1,
    minAlongsideDays: 2,
  },
};

const input = (over: Partial<ResearchExportInput> = {}): ResearchExportInput => ({
  detections: [],
  events: [],
  indicatorSets: [set],
  notes: new Map(),
  productVersion: "0.0.0-test",
  rulesetVersion: "test",
  browser: { browser: "firefox", browserVersion: "140.0", capabilities: [], notes: [] },
  now: new Date("2026-11-07T12:00:00.000Z"),
  ...over,
});

describe("hand-off seenAlongside", () => {
  const out = JSON.parse(
    exportResearch({ type: "export_handoff", profile: "default" }, input({ alongside: listing }))
      .text,
  );
  it("has the section with the disclaimer, frame rows and page-scope rows", () => {
    const s = out.observations.seenAlongside;
    expect(s.disclaimer).toBe(SEEN_ALONGSIDE_DISCLAIMER);
    expect(s.rows).toEqual([
      expect.objectContaining({
        hostname: "creative.synthetic-cdn.test",
        scope: "frame",
        alongsideDays: 3,
        seenDays: 4,
        share: 0.75,
        anchors: ["s-1"],
        frameDays: 3,
        pageDays: 1,
      }),
    ]);
    expect(s.pageOnly[0].scope).toBe("page");
    expect(out.readme).toContain("observations.seenAlongside");
  });
  it("the strict profile omits the hostnames but keeps disclaimer, counts and a note", () => {
    const strict = JSON.parse(
      exportResearch({ type: "export_handoff", profile: "strict" }, input({ alongside: listing }))
        .text,
    );
    const s = strict.observations.seenAlongside;
    expect(s.omitted).toBe(true);
    expect(s.rows).toEqual([]);
    expect(s.pageOnly).toEqual([]);
    expect(s.disclaimer).toBe(SEEN_ALONGSIDE_DISCLAIMER);
    expect(s.note).toMatch(/strict/i);
    expect(s.totals.anchorsSeen).toBe(5);
    expect(JSON.stringify(strict.observations)).not.toContain("synthetic-cdn.test");
  });
  it("is present and empty without a listing", () => {
    const empty = JSON.parse(
      exportResearch({ type: "export_handoff", profile: "default" }, input()).text,
    );
    expect(empty.observations.seenAlongside.rows).toEqual([]);
    expect(empty.observations.seenAlongside.disclaimer).toBe(SEEN_ALONGSIDE_DISCLAIMER);
  });
  it("contains only hostnames, counts and ids: no URL, path or query", () => {
    const text = JSON.stringify(out.observations.seenAlongside);
    expect(text).not.toMatch(/https?:|\?|=/);
    for (const r of [
      ...out.observations.seenAlongside.rows,
      ...out.observations.seenAlongside.pageOnly,
    ])
      expect(r.hostname).toMatch(/^[a-z0-9.-]+$/);
  });
});

describe("STIX export with seen alongside", () => {
  const stix = (alongside?: AlongsideListing) =>
    JSON.parse(
      exportResearch(
        { type: "export_stix", includeIndicators: true },
        input(alongside ? { alongside } : {}),
      ).text,
    ) as { objects: Array<Record<string, unknown>> };

  it("adds observed-data and a relationship to the indicator, and no extra indicator", () => {
    const b = stix(listing);
    const types = (t: string) => b.objects.filter((o) => o["type"] === t);
    expect(types("relationship")).toHaveLength(1);
    expect(types("relationship")[0]!["relationship_type"]).toBe("related-to");
    expect(types("indicator")).toHaveLength(1);
    expect(JSON.stringify(types("indicator"))).not.toContain("synthetic-cdn");
    const names = types("domain-name").map((o) => o["value"]);
    expect(names).toContain("creative.synthetic-cdn.test");
    // page-scope-only rows are not exported to STIX
    expect(names).not.toContain("pageonly.synthetic-cdn.test");
  });
  it("is unchanged without a listing", () => {
    const b = stix();
    expect(b.objects.some((o) => o["type"] === "relationship")).toBe(false);
  });
});

describe("SIEM export", () => {
  it("does not carry seen-alongside data", () => {
    const text = exportResearch({ type: "export_siem" }, input({ alongside: listing })).text;
    expect(text).not.toContain("synthetic-cdn");
  });
});
