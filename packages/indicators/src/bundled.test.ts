import { describe, expect, it } from "vitest";
import { BUNDLED_INDICATOR_SETS, loadBundledMatcher } from "./bundled.js";
import { IndicatorMatcher } from "./matcher.js";

const RESERVED = /(^|\.)(test|invalid|example|localhost)$/;

describe("bundled indicators", () => {
  const set = BUNDLED_INDICATOR_SETS[0];
  const matcher = loadBundledMatcher();

  it("loads the real, non-synthetic set", () => {
    expect(BUNDLED_INDICATOR_SETS).toHaveLength(1);
    expect(set?.meta.id).toBe("adfection-2026");
    expect(set?.meta.synthetic).toBe(false);
    expect(set?.indicators.length).toBeGreaterThan(150);
    expect(matcher.size).toBeGreaterThan(150);
  });

  it("contains the key documented indicators", () => {
    const find = (v: string) => set?.indicators.find((i) => i.indicator === v);
    expect(find("noas.mtrtb.com")).toMatchObject({
      indicatorType: "hostname",
      classification: "surveillance",
      role: "noas",
    });
    expect(find("keyadapter.com")).toMatchObject({
      indicatorType: "domain",
      classification: "malicious",
      role: "validator",
    });
    expect(find("adtimizer.co")).toMatchObject({ classification: "contextual" });
  });

  it("matches through the bundled matcher", () => {
    expect(matcher.match("keyadapter.com")[0]?.indicator.classification).toBe("malicious");
    expect(matcher.match("deep.sub.keyadapter.com").length).toBeGreaterThan(0);
    expect(matcher.match("noas.mtrtb.com").some((m) => m.indicator.role === "noas")).toBe(true);
  });

  it("contains no reserved-TLD names", () => {
    for (const i of set?.indicators ?? []) expect(i.indicator).not.toMatch(RESERVED);
  });

  it("returns independent matcher instances", () => {
    expect(loadBundledMatcher()).not.toBe(matcher);
    expect(loadBundledMatcher()).toBeInstanceOf(IndicatorMatcher);
  });
});
