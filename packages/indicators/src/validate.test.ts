import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BROAD_DOMAIN_DENYLIST, validateIndicatorSet } from "./validate.js";

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const realSet = readJson("../data/adfection-2026.json");
const syntheticSet = readJson("../../../tests/fixtures/indicators/synthetic.json");

type Obj = Record<string, unknown>;

function baseRecord(over: Obj = {}): Obj {
  return {
    id: "t-1",
    indicator: "example-tracker.test",
    indicatorType: "domain",
    source: "s",
    sourceUrl: "https://example.test/s",
    campaign: "c",
    classification: "surveillance",
    confidence: "high",
    firstReported: "2026-01-01",
    lastReviewed: "2026-01-02",
    enabled: true,
    ...over,
  };
}

function baseSet(records: Obj[] = [baseRecord()], metaOver: Obj = {}): Obj {
  return {
    meta: {
      id: "t",
      name: "t",
      version: "1",
      asOf: "2026-01-01",
      license: "x",
      synthetic: true,
      sources: [{ name: "n", url: "https://example.test", published: "2026-01-01" }],
      ...metaOver,
    },
    indicators: records,
  };
}

function errorsOf(input: unknown): string[] {
  const r = validateIndicatorSet(input);
  if (r.ok) throw new Error("expected validation failure");
  return r.errors;
}

describe("validateIndicatorSet", () => {
  it("accepts the real and synthetic fixture files", () => {
    expect(validateIndicatorSet(realSet).ok).toBe(true);
    expect(validateIndicatorSet(syntheticSet).ok).toBe(true);
  });

  it("accepts a minimal valid set and normalizes indicators", () => {
    const r = validateIndicatorSet(baseSet([baseRecord({ indicator: "Example-Tracker[.]test." })]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.set.indicators[0]?.indicator).toBe("example-tracker.test");
  });

  it("rejects non-objects", () => {
    expect(validateIndicatorSet(null).ok).toBe(false);
    expect(validateIndicatorSet("x").ok).toBe(false);
    expect(validateIndicatorSet([]).ok).toBe(false);
  });

  it("rejects missing fields and collects all errors", () => {
    const rec = baseRecord();
    delete rec["source"];
    delete rec["campaign"];
    delete rec["enabled"];
    const errs = errorsOf(baseSet([rec]));
    expect(errs.some((e) => e.includes("source"))).toBe(true);
    expect(errs.some((e) => e.includes("campaign"))).toBe(true);
    expect(errs.some((e) => e.includes("enabled"))).toBe(true);
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects missing meta / indicators", () => {
    expect(errorsOf({ indicators: [] }).some((e) => e.startsWith("meta"))).toBe(true);
    expect(errorsOf({ meta: baseSet().meta as Obj }).some((e) => e.startsWith("indicators"))).toBe(
      true,
    );
  });

  it("rejects bad enums", () => {
    expect(errorsOf(baseSet([baseRecord({ classification: "evil" })])).join()).toContain(
      "classification",
    );
    expect(errorsOf(baseSet([baseRecord({ confidence: "certain" })])).join()).toContain(
      "confidence",
    );
    expect(errorsOf(baseSet([baseRecord({ indicatorType: "regex" })])).join()).toContain(
      "indicatorType",
    );
  });

  it("requires boolean meta.synthetic", () => {
    expect(errorsOf(baseSet([baseRecord()], { synthetic: "yes" })).join()).toContain(
      "meta.synthetic",
    );
    const m = baseSet().meta as Obj;
    delete m["synthetic"];
    expect(errorsOf({ meta: m, indicators: [] }).join()).toContain("meta.synthetic");
  });

  it("rejects IP addresses as domain/hostname", () => {
    expect(errorsOf(baseSet([baseRecord({ indicator: "1.2.3.4" })])).join()).toContain("IP");
    expect(
      errorsOf(baseSet([baseRecord({ indicator: "1.2.3.4", indicatorType: "hostname" })])).join(),
    ).toContain("IP");
    expect(errorsOf(baseSet([baseRecord({ indicator: "[::1]" })])).join()).toContain("IP");
  });

  it("rejects invalid hostnames and single labels", () => {
    expect(errorsOf(baseSet([baseRecord({ indicator: "a b.test" })])).join()).toContain(
      "not a valid hostname",
    );
    expect(errorsOf(baseSet([baseRecord({ indicator: "com" })])).join()).toContain("dot");
    expect(
      errorsOf(baseSet([baseRecord({ indicator: "localhost", indicatorType: "hostname" })])).join(),
    ).toContain("dot");
  });

  it("rejects broad domains", () => {
    expect(BROAD_DOMAIN_DENYLIST).toContain("cloudfront.net");
    for (const d of BROAD_DOMAIN_DENYLIST) {
      expect(
        errorsOf(baseSet([baseRecord({ indicator: d, indicatorType: "domain" })])).join(),
      ).toContain("too broad");
      expect(
        errorsOf(baseSet([baseRecord({ indicator: d, indicatorType: "hostname" })])).join(),
      ).toContain("too broad");
    }
  });

  it("allows a hostname that is a subdomain of a broad name", () => {
    const r = validateIndicatorSet(
      baseSet([
        baseRecord({ indicator: "d111111abcdef8.cloudfront.net", indicatorType: "hostname" }),
      ]),
    );
    expect(r.ok).toBe(true);
  });

  it("requires pathPattern starting with / for path types", () => {
    for (const indicatorType of ["hostname_path", "url_path"]) {
      const indicator = indicatorType === "url_path" ? "/getAd" : "example-tracker.test";
      expect(errorsOf(baseSet([baseRecord({ indicatorType, indicator })])).join()).toContain(
        "pathPattern",
      );
      expect(
        errorsOf(baseSet([baseRecord({ indicatorType, indicator, pathPattern: "getAd" })])).join(),
      ).toContain("pathPattern");
      expect(
        validateIndicatorSet(
          baseSet([baseRecord({ indicatorType, indicator, pathPattern: "/getAd" })]),
        ).ok,
      ).toBe(true);
    }
  });

  it("rejects duplicate ids", () => {
    const errs = errorsOf(baseSet([baseRecord(), baseRecord({ indicator: "other.test" })]));
    expect(errs.join()).toContain("duplicate id");
  });

  it("rejects bad dates", () => {
    expect(errorsOf(baseSet([baseRecord({ firstReported: "2026/01/01" })])).join()).toContain(
      "firstReported",
    );
    expect(errorsOf(baseSet([baseRecord({ lastReviewed: "2026-02-30" })])).join()).toContain(
      "lastReviewed",
    );
    expect(errorsOf(baseSet([baseRecord()], { asOf: "yesterday" })).join()).toContain("meta.asOf");
    expect(
      errorsOf(
        baseSet([baseRecord()], { sources: [{ name: "n", url: "u", published: "x" }] }),
      ).join(),
    ).toContain("published");
  });
});
