import { readFileSync } from "node:fs";
import type { IndicatorRecord, IndicatorSet } from "@adtripwire/shared";
import { describe, expect, it } from "vitest";
import { IndicatorMatcher, strongestClassification } from "./matcher.js";
import { validateIndicatorSet } from "./validate.js";

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const real = readJson("../data/adfection-2026.json");
const synthetic = readJson("../../../tests/fixtures/indicators/synthetic.json");

function rec(
  over: Partial<IndicatorRecord> & Pick<IndicatorRecord, "id" | "indicator" | "indicatorType">,
): IndicatorRecord {
  return {
    source: "s",
    sourceUrl: "https://example.test",
    campaign: "c",
    classification: "surveillance",
    confidence: "high",
    firstReported: "2026-01-01",
    lastReviewed: "2026-01-01",
    enabled: true,
    ...over,
  };
}

function setOf(id: string, indicators: IndicatorRecord[]): IndicatorSet {
  return {
    meta: {
      id,
      name: id,
      version: "1",
      asOf: "2026-01-01",
      license: "x",
      synthetic: true,
      sources: [],
    },
    indicators,
  };
}

function load(raw: unknown): IndicatorSet {
  const r = validateIndicatorSet(raw);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.set;
}

const ids = (ms: { indicator: IndicatorRecord }[]): string[] => ms.map((m) => m.indicator.id);

describe("domain / hostname matching (real data)", () => {
  const m = new IndicatorMatcher([load(real)]);

  it("domain entry matches apex and all subdomains", () => {
    const apex = m.match("mtrtb.com").map((x) => x.indicator.indicator);
    expect(apex).toEqual(["mtrtb.com"]);
    for (const h of ["unlisted.mtrtb.com", "a.b.mtrtb.com", "MTRTB.com."]) {
      const hits = m.match(h);
      expect(
        hits.some((x) => x.indicator.indicator === "mtrtb.com" && x.matchKind === "domain_suffix"),
      ).toBe(true);
    }
  });

  it("does not match lookalikes", () => {
    for (const h of ["notmtrtb.com", "mtrtb.com.attacker.test", "mtrtb.co", "com"]) {
      expect(m.match(h)).toEqual([]);
    }
  });

  it("hostname entries and a covering domain entry both match", () => {
    const hits = m.match("noas.mtrtb.com");
    expect(hits.map((x) => [x.indicator.indicator, x.matchKind])).toEqual(
      expect.arrayContaining([
        ["noas.mtrtb.com", "exact_hostname"],
        ["mtrtb.com", "domain_suffix"],
      ]),
    );
    expect(new Set(ids(hits)).size).toBe(hits.length);
  });

  it("hostname-type entries match only exactly; apex contextual domain is separate", () => {
    const self = m.match("dtech.adtimizer.co");
    expect(
      self.map((x) => [
        x.indicator.indicator,
        x.indicator.indicatorType,
        x.indicator.classification,
      ]),
    ).toEqual([
      ["dtech.adtimizer.co", "hostname", "surveillance"],
      ["adtimizer.co", "domain", "contextual"],
    ]);
    const sub = m.match("x.dtech.adtimizer.co");
    expect(sub.map((x) => x.indicator.indicator)).toEqual(["adtimizer.co"]);
    const apex = m.match("adtimizer.co");
    expect(apex.map((x) => [x.indicator.indicator, x.indicator.classification])).toEqual([
      ["adtimizer.co", "contextual"],
    ]);
  });

  it("returns [] for invalid hostnames and IPs", () => {
    expect(m.match("")).toEqual([]);
    expect(m.match("a b")).toEqual([]);
    expect(m.match("1.2.3.4")).toEqual([]);
  });

  it("reports the set id", () => {
    expect(m.match("keyadapter.com")[0]?.setId).toBe("adfection-2026");
  });
});

describe("synthetic set", () => {
  const m = new IndicatorMatcher([load(synthetic)]);

  it("disabled indicators never match", () => {
    expect(m.match("disabled.synthetic-adfection.test")).toEqual([]);
    expect(m.has("syn-0007")).toBe(false);
    expect(m.has("syn-0001")).toBe(true);
    expect(m.size).toBe(6);
  });

  it("exact hostname", () => {
    expect(m.match("c2.synthetic-adfection.test").map((x) => x.matchKind)).toEqual([
      "exact_hostname",
    ]);
    expect(m.match("x.c2.synthetic-adfection.test")).toEqual([]);
  });

  it("domain suffix", () => {
    expect(ids(m.match("a.b.synthetic-dsp.test"))).toEqual(["syn-0004"]);
  });

  it("exposes set metadata", () => {
    expect(m.sets.map((s) => s.id)).toEqual(["synthetic-test"]);
  });
});

describe("path matching", () => {
  const m = new IndicatorMatcher([
    setOf("p", [
      rec({
        id: "hp",
        indicator: "ads.example.test",
        indicatorType: "hostname_path",
        pathPattern: "/getAd",
      }),
      rec({
        id: "up",
        indicator: "/pixel",
        indicatorType: "url_path",
        pathPattern: "/pixel/v1",
        classification: "contextual",
      }),
    ]),
  ]);

  it("hostname_path requires exact host and prefix at a boundary", () => {
    expect(m.match("ads.example.test", "/getAd").map((x) => x.matchKind)).toEqual([
      "hostname_path",
    ]);
    expect(ids(m.match("ads.example.test", "/getAd/"))).toEqual(["hp"]);
    expect(ids(m.match("ads.example.test", "/getAd/x/y"))).toEqual(["hp"]);
    expect(ids(m.match("ads.example.test", "/getAd?x=1"))).toEqual(["hp"]);
    expect(m.match("ads.example.test", "/getAdvanced")).toEqual([]);
    expect(m.match("ads.example.test", "/getad")).toEqual([]);
    expect(m.match("ads.example.test", "/other")).toEqual([]);
    expect(m.match("ads.example.test")).toEqual([]);
    expect(m.match("sub.ads.example.test", "/getAd")).toEqual([]);
    expect(m.match("other.test", "/getAd")).toEqual([]);
  });

  it("url_path matches any host", () => {
    expect(m.match("anything.test", "/pixel/v1").map((x) => x.matchKind)).toEqual(["url_path"]);
    expect(ids(m.match("1.2.3.4", "/pixel/v1/img.gif"))).toEqual(["up"]);
    expect(m.match("anything.test", "/pixel/v10")).toEqual([]);
    expect(m.match("anything.test")).toEqual([]);
  });

  it("a trailing-slash pattern matches deeper paths", () => {
    const mm = new IndicatorMatcher([
      setOf("q", [
        rec({ id: "s", indicator: "/a/", indicatorType: "url_path", pathPattern: "/a/" }),
      ]),
    ]);
    expect(ids(mm.match("h.test", "/a/b"))).toEqual(["s"]);
    expect(mm.match("h.test", "/a")).toEqual([]);
  });
});

describe("ordering, dedup, strongestClassification", () => {
  const set = setOf("o", [
    rec({
      id: "z-ctx",
      indicator: "example.test",
      indicatorType: "domain",
      classification: "contextual",
      confidence: "high",
    }),
    rec({
      id: "b-surv-med",
      indicator: "example.test",
      indicatorType: "domain",
      classification: "surveillance",
      confidence: "medium",
    }),
    rec({
      id: "a-surv-high",
      indicator: "a.example.test",
      indicatorType: "hostname",
      classification: "surveillance",
      confidence: "high",
    }),
    rec({
      id: "c-surv-high",
      indicator: "a.example.test",
      indicatorType: "hostname",
      classification: "surveillance",
      confidence: "high",
    }),
    rec({
      id: "m-low",
      indicator: "example.test",
      indicatorType: "domain",
      classification: "malicious",
      confidence: "low",
    }),
    rec({
      id: "m-high",
      indicator: "example.test",
      indicatorType: "domain",
      classification: "malicious",
      confidence: "high",
    }),
    rec({
      id: "off",
      indicator: "example.test",
      indicatorType: "domain",
      classification: "malicious",
      enabled: false,
    }),
  ]);
  const m = new IndicatorMatcher([set]);

  it("orders by classification, confidence, id", () => {
    expect(ids(m.match("a.example.test"))).toEqual([
      "m-high",
      "m-low",
      "a-surv-high",
      "c-surv-high",
      "b-surv-med",
      "z-ctx",
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const m2 = new IndicatorMatcher([setOf("o", [...set.indicators].reverse())]);
    expect(ids(m2.match("a.example.test"))).toEqual(ids(m.match("a.example.test")));
  });

  it("de-duplicates by indicator id (within and across sets)", () => {
    const dup = new IndicatorMatcher([
      setOf("s1", [rec({ id: "d", indicator: "dup.test", indicatorType: "domain" })]),
      setOf("s2", [rec({ id: "d", indicator: "dup.test", indicatorType: "domain" })]),
    ]);
    const hits = dup.match("dup.test");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.setId).toBe("s1");
    expect(dup.size).toBe(1);
  });

  it("strongestClassification", () => {
    expect(strongestClassification([])).toBeNull();
    expect(strongestClassification(m.match("a.example.test"))).toBe("malicious");
    expect(strongestClassification(m.match("a.example.test").slice(2))).toBe("surveillance");
    expect(strongestClassification(m.match("a.example.test").slice(-1))).toBe("contextual");
  });
});

describe("IndicatorMatcher.fromJson", () => {
  it("loads valid sets and skips invalid ones with errors", () => {
    const { matcher, errors } = IndicatorMatcher.fromJson([synthetic, { nope: true }, real]);
    expect(matcher.sets.map((s) => s.id)).toEqual(["synthetic-test", "adfection-2026"]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.startsWith("set[1]"))).toBe(true);
    expect(matcher.match("c2.synthetic-adfection.test")).toHaveLength(1);
  });

  it("skips duplicate set ids", () => {
    const { matcher, errors } = IndicatorMatcher.fromJson([synthetic, synthetic]);
    expect(matcher.sets).toHaveLength(1);
    expect(errors.join()).toContain("duplicate set id");
  });
});
