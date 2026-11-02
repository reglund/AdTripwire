import type { IndicatorRecord, IndicatorSet } from "@adtripwire/shared";
import { describe, expect, it } from "vitest";
import { BUNDLED_INDICATOR_SETS } from "./bundled.js";
import { IndicatorMatcher } from "./matcher.js";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("matcher performance sanity", () => {
  it("200k match() calls against ~10k domains complete in < 2s", () => {
    const rand = mulberry32(42);
    const word = (): string => {
      let s = "";
      const n = 6 + Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) s += String.fromCharCode(97 + Math.floor(rand() * 26));
      return s;
    };
    const tlds = ["test", "invalid", "example", "com", "net", "io"];
    const domains: string[] = [];
    const records: IndicatorRecord[] = [];
    for (let i = 0; i < 10_000; i++) {
      const d = `${word()}-${i}.${tlds[i % tlds.length]}`;
      domains.push(d);
      records.push({
        id: `perf-${i}`,
        indicator: d,
        indicatorType: "domain",
        source: "s",
        sourceUrl: "https://example.test",
        campaign: "perf",
        classification: "surveillance",
        confidence: "medium",
        firstReported: "2026-01-01",
        lastReviewed: "2026-01-01",
        enabled: true,
      });
    }
    const synthetic: IndicatorSet = {
      meta: {
        id: "perf",
        name: "perf",
        version: "1",
        asOf: "2026-01-01",
        license: "x",
        synthetic: true,
        sources: [],
      },
      indicators: records,
    };
    const matcher = new IndicatorMatcher([...BUNDLED_INDICATOR_SETS, synthetic]);

    const queries: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const d = domains[Math.floor(rand() * domains.length)] ?? "x.test";
      queries.push(
        d,
        `a.b.${d}`,
        `${word()}.${word()}.com`,
        `www.${word()}.org`,
        `cdn.${d}.evil.test`,
      );
    }

    const start = performance.now();
    let hits = 0;
    for (let i = 0; i < 200_000; i++) {
      hits += matcher.match(queries[i % queries.length] ?? "x.test").length;
    }
    const elapsed = performance.now() - start;

    expect(hits).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  });
});
