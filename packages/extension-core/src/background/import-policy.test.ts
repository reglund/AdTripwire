import { describe, expect, it } from "vitest";
import type { IndicatorRecord, IndicatorSet } from "@adtripwire/shared";
import { applyBundledPrecedence, summariseDrops } from "./import-policy.js";

const rec = (
  indicator: string,
  indicatorType: IndicatorRecord["indicatorType"],
  extra: Partial<IndicatorRecord> = {},
): IndicatorRecord => ({
  id: `x-${indicator}`,
  indicator,
  indicatorType,
  source: "t",
  sourceUrl: "https://example.test/",
  campaign: "t",
  classification: "malicious",
  confidence: "high",
  firstReported: "2026-01-01",
  lastReviewed: "2026-01-01",
  enabled: true,
  ...extra,
});
const set = (id: string, indicators: IndicatorRecord[], synthetic = false): IndicatorSet => ({
  meta: { id, name: id, version: "1", asOf: "2026-01-01", license: "CC0", synthetic, sources: [] },
  indicators,
});
const bundled = [
  set("b", [
    rec("mtrtb.synthetic.test", "domain", { classification: "surveillance" }),
    rec("dtech.adtimizer.synthetic.test", "hostname", { classification: "surveillance" }),
    rec("adtimizer.synthetic.test", "domain", { classification: "contextual" }),
  ]),
];

describe("applyBundledPrecedence", () => {
  it("drops exact, parent and child overlaps and url_path records", () => {
    const imported = set("i", [
      rec("mtrtb.synthetic.test", "domain"), // exact
      rec("noas.mtrtb.synthetic.test", "hostname"), // child of bundled domain
      rec("synthetic.test", "domain"), // parent covering bundled hosts
      rec("x.dtech.adtimizer.synthetic.test", "hostname"), // child of bundled hostname? covered by adtimizer domain
      rec("/getAd", "url_path", { pathPattern: "/getAd" }),
      rec("fresh.synthetic-other.test", "domain"), // kept
    ]);
    const r = applyBundledPrecedence(imported, bundled);
    expect(r.kept.map((k) => k.indicator)).toEqual(["fresh.synthetic-other.test"]);
    expect(r.dropped.length).toBe(5);
    const warnings = summariseDrops(r.dropped);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(" ")).not.toMatch(/mtrtb\.synthetic\.test/);
  });
  it("ignores synthetic bundled sets and disabled bundled records", () => {
    const b = [
      set("syn", [rec("c2.synthetic-adfection.test", "hostname")], true),
      set("b2", [rec("off.synthetic.test", "domain", { enabled: false })]),
    ];
    const r = applyBundledPrecedence(
      set("i", [
        rec("c2.synthetic-adfection.test", "hostname"),
        rec("a.off.synthetic.test", "hostname"),
      ]),
      b,
    );
    expect(r.kept.length).toBe(2);
  });
});
