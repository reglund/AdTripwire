import { describe, expect, it } from "vitest";
import { selectFeedIndicators, toSuricataRules, toZeekIntel, ZEEK_INTEL_HEADER } from "./feeds.js";
import { makeSet } from "./test-fixtures.js";

const generatedAt = new Date("2026-11-02T00:00:00.000Z");
const real = makeSet();
const synthetic = makeSet({ id: "synthetic-x", synthetic: true });
synthetic.indicators = synthetic.indicators.map((r) => ({
  ...r,
  id: `x-${r.id}`,
  indicator: `synthname-${r.indicator}`,
}));

describe("selectFeedIndicators", () => {
  it("excludes synthetic sets, disabled and expired records", () => {
    const sel = selectFeedIndicators([real, synthetic], generatedAt);
    expect(sel.active.map((a) => a.record.id)).toEqual(["s-1", "s-2", "s-3", "s-4", "s-7"]);
    expect(sel.excluded).toEqual({ synthetic: 7, disabled: 1, expired: 1 });
  });
});

describe("toZeekIntel", () => {
  const text = toZeekIntel([real, synthetic], { generatedAt });
  const lines = text.trimEnd().split("\n");

  it("has the exact header and 6 tab-separated columns per line", () => {
    expect(lines[0]).toBe(ZEEK_INTEL_HEADER);
    expect(lines[0]).toBe(
      "#fields\tindicator\tindicator_type\tmeta.source\tmeta.desc\tmeta.url\tmeta.do_notice",
    );
    for (const l of lines.slice(1)) expect(l.split("\t")).toHaveLength(6);
    expect(lines).toHaveLength(1 + 5);
  });

  it("maps types and fields", () => {
    const rows = new Map(lines.slice(1).map((l) => [l.split("\t")[0]!, l.split("\t")]));
    expect(rows.get("tracker-one.test")![1]).toBe("Intel::DOMAIN");
    expect(rows.get("shared-bucket.cdn.test/Campaign_Path/")![1]).toBe("Intel::URL");
    expect(rows.get("c2.evil-host.test")![5]).toBe("T");
    expect(rows.get("tracker-one.test")![5]).toBe("F");
    expect(rows.get("tracker-one.test")![3]).toBe(
      "surveillance/tracking: Synthetic tracking domain. With a tab and a 'quote'.",
    );
    expect(rows.get("tracker-one.test")![4]).toBe("https://report.example.test/adfection");
  });

  it("excludes synthetic, disabled and expired entries", () => {
    expect(text).not.toContain("synthname-");
    expect(text).not.toContain("disabled.test");
    expect(text).not.toContain("rotated.staging.test");
    // Before the expiry date the windowed record is included.
    expect(toZeekIntel([real], { generatedAt: new Date("2026-10-18T00:00:00Z") })).toContain(
      "rotated.staging.test",
    );
  });

  it("truncates notes to 120 characters", () => {
    const long = makeSet();
    long.indicators = [{ ...long.indicators[0]!, notes: "x".repeat(300) }];
    const desc = toZeekIntel([long], { generatedAt }).trimEnd().split("\n")[1]!.split("\t")[3]!;
    expect(desc).toBe(`surveillance/tracking: ${"x".repeat(120)}`);
  });
});

describe("toSuricataRules", () => {
  const text = toSuricataRules([real, synthetic], { generatedAt });
  const rules = text.trimEnd().split("\n");

  it("emits 3 rules per host indicator and 1 per hostname_path", () => {
    // s-1 (domain), s-2, s-3 (hostname), s-7 (domain) → 4 × 3; s-4 (hostname_path) → 1.
    expect(rules).toHaveLength(4 * 3 + 1);
  });

  it("is structurally well-formed with unique sids and rev:1", () => {
    const sids = new Set<string>();
    for (const r of rules) {
      expect(r).toMatch(/^alert (dns|tls|http) any any -> any any \(msg:"ADTRIPWIRE [^"]+"; .*\)$/);
      expect(r.endsWith(";)")).toBe(true);
      expect(r).toContain("rev:1;");
      const sid = /sid:(\d+);/.exec(r)![1]!;
      expect(sids.has(sid)).toBe(false);
      sids.add(sid);
      expect(Number(sid)).toBeGreaterThanOrEqual(9_400_000);
      expect(r).toMatch(
        /metadata:adtripwire_classification (malicious|surveillance|contextual), adtripwire_role [a-z0-9_.-]+, adtripwire_source [a-z0-9_.-]+, /,
      );
      expect(r).toContain("reference:url,report.example.test/adfection;");
    }
    expect(text).not.toContain("synthname-");
  });

  it("uses dotprefix+endswith for domains and exact matching for hostnames", () => {
    const dns = rules.filter((r) => r.startsWith("alert dns"));
    expect(dns.find((r) => r.includes("tracker-one.test"))).toContain(
      'dns.query; dotprefix; content:".tracker-one.test"; nocase; endswith;',
    );
    expect(dns.find((r) => r.includes("c2.evil-host.test"))).toContain(
      'dns.query; content:"c2.evil-host.test"; nocase; startswith; endswith;',
    );
    const mal = rules.find((r) => r.includes("c2.evil-host.test"))!;
    expect(mal).toContain("classtype:trojan-activity;");
    expect(rules.find((r) => r.includes("tracker-one.test"))).toContain(
      "classtype:policy-violation;",
    );
    expect(rules.some((r) => r.includes('tls.sni; dotprefix; content:".tracker-one.test"'))).toBe(
      true,
    );
    const host = rules.find(
      (r) => r.includes("http.host; dotprefix") && r.includes("tracker-one"),
    )!;
    expect(host).not.toContain("nocase");
    const path = rules.find((r) => r.includes("http.uri"))!;
    expect(path).toContain(
      'http.host; content:"shared-bucket.cdn.test"; startswith; endswith; http.uri; content:"/Campaign_Path/"; startswith;',
    );
    expect(rules.filter((r) => r.includes("shared-bucket.cdn.test"))).toHaveLength(1);
  });

  it("keeps sids stable when other records are disabled or expire", () => {
    const sidsFor = (text: string, host: string) =>
      text
        .split("\n")
        .filter((l) => l.includes(`"ADTRIPWIRE malicious ${host} `))
        .map((l) => /sid:(\d+);/.exec(l)![1]);
    const before = sidsFor(text, "c2.evil-host.test");
    const changed = makeSet();
    changed.indicators[0] = { ...changed.indicators[0]!, enabled: false };
    expect(
      sidsFor(toSuricataRules([changed, synthetic], { generatedAt }), "c2.evil-host.test"),
    ).toEqual(before);
    expect(before).toEqual(["9400004", "9400005", "9400006"]);
  });

  it("escapes msg and content and honours sidBase", () => {
    const odd = makeSet();
    odd.indicators = [
      {
        ...odd.indicators[0]!,
        classification: "surveillance",
        indicatorType: "hostname_path",
        pathPattern: '/a";b|c',
      },
    ];
    const r = toSuricataRules([odd], { generatedAt, sidBase: 1000 }).trimEnd();
    expect(r).toContain(String.raw`msg:"ADTRIPWIRE surveillance tracker-one.test/a\"\;b|c HTTP"`);
    expect(r).toContain('content:"/a|22||3B|b|7C|c"');
    expect(r).toContain("sid:1003;");
  });
});
