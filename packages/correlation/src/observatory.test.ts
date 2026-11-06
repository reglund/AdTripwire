import { describe, expect, it } from "vitest";
import {
  BUNDLED_OBSERVATORY,
  observatoryLookup,
  observatorySummary,
  validateObservatorySnapshot,
  type ObservatorySnapshot,
} from "./observatory.js";
import snapshotJson from "../data/observatory-snapshot.json";

const host = (name: string, extra: Record<string, unknown> = {}) => ({
  host: name,
  first: "2026-11-02",
  last: "2026-11-04",
  days: 2,
  runs: 3,
  sites: ["news.org"],
  variants: 2,
  rigs: 1,
  ...extra,
});

const base = (hosts: unknown[] = [host("b.net")]): Record<string, unknown> => ({
  schemaVersion: 1,
  source: "https://reglund.github.io/adtripwire-observatory/data/index.json",
  generatedAt: "2026-11-06T05:18:45.652Z",
  period: { from: "2026-11-02", to: "2026-11-05", days: 4 },
  rigs: 1,
  runs: 19,
  hosts,
});

function parsed(raw: Record<string, unknown>): ObservatorySnapshot {
  const r = validateObservatorySnapshot(raw);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.snapshot;
}

describe("validateObservatorySnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(validateObservatorySnapshot(base()).ok).toBe(true);
  });

  it("validates the bundled snapshot", () => {
    const r = validateObservatorySnapshot(snapshotJson);
    expect(r.ok ? [] : r.errors).toEqual([]);
    expect(BUNDLED_OBSERVATORY.hosts.length).toBeGreaterThan(0);
  });

  it.each([".test", ".invalid", ".example", ".localhost"])("rejects the reserved TLD %s", (tld) => {
    expect(validateObservatorySnapshot(base([host(`tracker${tld}`)])).ok).toBe(false);
    expect(validateObservatorySnapshot(base([host("b.net", { sites: [`site${tld}`] })])).ok).toBe(
      false,
    );
  });

  it.each(["not a host", "UPPER.net", "nodot", "10.0.0.1", "", 5])("rejects host %j", (bad) => {
    expect(validateObservatorySnapshot(base([host(bad as string)])).ok).toBe(false);
  });

  it("rejects bad dates and an inverted range", () => {
    expect(validateObservatorySnapshot(base([host("b.net", { first: "2026-13-01" })])).ok).toBe(
      false,
    );
    expect(validateObservatorySnapshot(base([host("b.net", { last: "11/04/2026" })])).ok).toBe(
      false,
    );
    expect(
      validateObservatorySnapshot(
        base([host("b.net", { first: "2026-11-05", last: "2026-11-01" })]),
      ).ok,
    ).toBe(false);
    expect(
      validateObservatorySnapshot({
        ...base(),
        period: { from: "2026-02-30", to: "2026-03-01", days: 1 },
      }).ok,
    ).toBe(false);
  });

  it("rejects negative or non-integer counts", () => {
    for (const bad of [-1, 1.5, "3", null]) {
      expect(validateObservatorySnapshot(base([host("b.net", { days: bad })])).ok).toBe(false);
    }
    expect(validateObservatorySnapshot({ ...base(), runs: -2 }).ok).toBe(false);
    expect(validateObservatorySnapshot({ ...base(), rigs: 0.5 }).ok).toBe(false);
  });

  it("rejects oversize tables", () => {
    const many = Array.from({ length: 501 }, (_, i) => host(`h${i}.net`));
    expect(validateObservatorySnapshot(base(many)).ok).toBe(false);
    const sites = Array.from({ length: 11 }, (_, i) => `s${i}.net`);
    expect(validateObservatorySnapshot(base([host("b.net", { sites })])).ok).toBe(false);
    expect(
      validateObservatorySnapshot(base([host("b.net", { sites: sites.slice(0, 10) })])).ok,
    ).toBe(true);
  });

  it("rejects duplicates, wrong schema version and non-objects", () => {
    expect(validateObservatorySnapshot(base([host("b.net"), host("b.net")])).ok).toBe(false);
    expect(validateObservatorySnapshot({ ...base(), schemaVersion: 2 }).ok).toBe(false);
    expect(validateObservatorySnapshot(null).ok).toBe(false);
    expect(validateObservatorySnapshot([]).ok).toBe(false);
  });
});

describe("observatoryLookup", () => {
  const snap = parsed(base([host("b.net"), host("exact.b.net", { days: 1 })]));

  it("finds the exact host", () => {
    expect(observatoryLookup("b.net", snap)?.host).toBe("b.net");
  });

  it("falls back to a parent domain on a label boundary", () => {
    expect(observatoryLookup("a.b.net", snap)?.host).toBe("b.net");
    expect(observatoryLookup("x.y.b.net", snap)?.host).toBe("b.net");
  });

  it("prefers the most specific entry", () => {
    expect(observatoryLookup("exact.b.net", snap)?.days).toBe(1);
    expect(observatoryLookup("deep.exact.b.net", snap)?.host).toBe("exact.b.net");
  });

  it("does not match a lookalike or a child entry from its parent", () => {
    expect(observatoryLookup("xb.net", snap)).toBeNull();
    expect(observatoryLookup("b.net.evil.org", snap)).toBeNull();
    expect(observatoryLookup("net", snap)).toBeNull();
    expect(observatoryLookup("not a host", snap)).toBeNull();
    expect(observatoryLookup("other.org", snap)).toBeNull();
  });

  it("normalizes case and a trailing dot", () => {
    expect(observatoryLookup("A.B.net.", snap)?.host).toBe("b.net");
  });

  it("looks up in the bundled snapshot by default", () => {
    const first = BUNDLED_OBSERVATORY.hosts[0];
    expect(first).toBeDefined();
    expect(observatoryLookup(`sub.${first?.host ?? ""}`)?.host).toBe(first?.host);
    expect(observatoryLookup("unlisted.invalid")).toBeNull();
  });
});

describe("observatorySummary", () => {
  it("reports the period, rigs and runs", () => {
    expect(observatorySummary(parsed(base()))).toEqual({
      asOf: "2026-11-05",
      from: "2026-11-02",
      to: "2026-11-05",
      days: 4,
      rigs: 1,
      runs: 19,
      hosts: 1,
    });
  });
});
