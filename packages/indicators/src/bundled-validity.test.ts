import { describe, expect, it } from "vitest";
import { BUNDLED_INDICATOR_SETS, loadBundledMatcher } from "./bundled.js";
import { indicatorValidity } from "./matcher.js";

describe("bundled validity windows", () => {
  const set = BUNDLED_INDICATOR_SETS[0];
  const records = set?.indicators ?? [];
  const isCloudFront = (v: string): boolean => v.endsWith(".cloudfront.net");

  it("gives every record validFrom equal to its source publication date", () => {
    const published = new Map((set?.meta.sources ?? []).map((s) => [s.name, s.published]));
    expect(records.length).toBeGreaterThan(150);
    for (const r of records) {
      expect(r.validFrom, r.id).toBeDefined();
      expect(r.validFrom, r.id).toBe(published.get(r.source));
      if (r.validTo !== undefined) expect((r.validFrom as string) <= r.validTo, r.id).toBe(true);
    }
  });

  it("gives all CloudFront staging entries a validTo", () => {
    const cf = records.filter((r) => isCloudFront(r.indicator));
    expect(cf.length).toBeGreaterThan(0);
    for (const r of cf) {
      expect(r.role, r.id).toBe("staging");
      expect(r.validTo, r.id).toBe("2026-12-31");
    }
  });

  it("gives no NOAS host (and nothing outside CloudFront) a validTo", () => {
    const noas = records.filter((r) => r.role === "noas");
    expect(noas.length).toBeGreaterThan(0);
    for (const r of noas) expect(r.validTo, r.id).toBeUndefined();
    for (const r of records.filter((x) => !isCloudFront(x.indicator))) {
      expect(r.validTo, r.id).toBeUndefined();
    }
  });

  it("reports CloudFront staging as expired after validTo and NOAS as current", () => {
    const cf = records.find((r) => isCloudFront(r.indicator));
    const noas = records.find((r) => r.indicator === "noas.mtrtb.com");
    expect(cf && noas).toBeTruthy();
    if (!cf || !noas) return;
    expect(indicatorValidity(cf, Date.parse("2026-11-02T00:00:00Z"))).toBe("current");
    expect(indicatorValidity(cf, Date.parse("2027-01-02T00:00:00Z"))).toBe("expired");
    expect(indicatorValidity(noas, Date.parse("2030-01-01T00:00:00Z"))).toBe("current");
    const m = loadBundledMatcher().match(
      cf.indicator,
      undefined,
      Date.parse("2027-01-02T00:00:00Z"),
    );
    expect(m[0]?.validity).toBe("expired");
  });
});
