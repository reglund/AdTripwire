import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPORT_DISCLAIMER } from "@adtripwire/privacy";
import type { IndicatorSet } from "@adtripwire/shared";
import {
  ADTRIPWIRE_IDENTITY_ID,
  detectionsToStix,
  indicatorSetToStix,
  stixIndicatorId,
  stixToIndicatorSet,
  TLP_CLEAR_MARKING_ID,
} from "./stix.js";
import type { StixBundle, StixObject } from "./stix.js";
import { parseDomainPattern } from "./stix-import.js";
import { INITIATOR, TOP_SITE, makeDetection, makeEvents, makeSet } from "./test-fixtures.js";

const ID_RE = /^[a-z0-9-]+--[0-9a-f-]{36}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SCO_TYPES = new Set(["domain-name", "url"]);
const producedAt = new Date("2026-11-02T12:00:00.000Z");

function checkCommon(bundle: StixBundle): void {
  expect(bundle.type).toBe("bundle");
  expect(bundle.id).toMatch(/^bundle--[0-9a-f-]{36}$/);
  expect(bundle).not.toHaveProperty("spec_version");
  const ids = new Set<string>();
  for (const o of bundle.objects) {
    expect(typeof o.type).toBe("string");
    expect(o.id).toMatch(ID_RE);
    expect(o.id.startsWith(`${o.type}--`)).toBe(true);
    expect(o.spec_version).toBe("2.1");
    expect(ids.has(o.id)).toBe(false);
    ids.add(o.id);
    if (SCO_TYPES.has(o.type)) {
      // SCOs have no created/modified in STIX 2.1.
      expect(o).not.toHaveProperty("created");
      continue;
    }
    expect(o.created).toMatch(TS_RE);
    expect(o.modified).toMatch(TS_RE);
    expect((o.modified as string) >= (o.created as string)).toBe(true);
    for (const k of [
      "valid_from",
      "valid_until",
      "first_observed",
      "last_observed",
      "published",
      "first_seen",
      "last_seen",
    ]) {
      if (k in o) expect(o[k]).toMatch(TS_RE);
    }
  }
  // Every *_ref / *_refs points at an object in the bundle (except the predefined TLP marking).
  for (const o of bundle.objects) {
    for (const [k, v] of Object.entries(o)) {
      const refs = k.endsWith("_refs") ? (v as string[]) : k.endsWith("_ref") ? [v as string] : [];
      for (const r of refs)
        if (r !== TLP_CLEAR_MARKING_ID) expect(ids.has(r), `${o.id}.${k} → ${r}`).toBe(true);
    }
  }
}

const byType = (b: StixBundle, t: string): StixObject[] => b.objects.filter((o) => o.type === t);

describe("indicatorSetToStix", () => {
  const set = makeSet();
  const bundle = indicatorSetToStix(set, { producedAt });

  it("produces well-formed STIX 2.1 objects", () => {
    checkCommon(bundle);
    expect(bundle.objects[0]!.id).toBe(ADTRIPWIRE_IDENTITY_ID);
  });

  it("emits one indicator per enabled record with well-formed patterns", () => {
    const inds = byType(bundle, "indicator");
    expect(inds).toHaveLength(set.indicators.filter((r) => r.enabled).length);
    const byName = new Map(inds.map((o) => [o.name as string, o]));
    expect(byName.get("tracker-one.test")!.pattern).toBe(
      "[domain-name:value = 'tracker-one.test']",
    );
    expect(byName.get("c2.evil-host.test")!.pattern).toBe(
      "[domain-name:value = 'c2.evil-host.test']",
    );
    expect(byName.get("shared-bucket.cdn.test/Campaign_Path/")!.pattern).toBe(
      "[url:value MATCHES '^https?://shared-bucket\\\\.cdn\\\\.test(:[0-9]+)?/Campaign_Path/']",
    );
    for (const o of inds) {
      expect(o.pattern as string).toMatch(/^\[(domain-name|url):value (=|MATCHES) '.*'\]$/);
      expect(o.pattern_type).toBe("stix");
      expect(o.created_by_ref).toBe(ADTRIPWIRE_IDENTITY_ID);
      expect(o.object_marking_refs).toEqual([TLP_CLEAR_MARKING_ID]);
    }
    expect(byName.get("tracker-one.test")!.description as string).toContain(
      "all of its subdomains",
    );
    expect(byName.has("disabled.test")).toBe(false);
  });

  it("maps classification, confidence, labels and validity", () => {
    const inds = new Map(byType(bundle, "indicator").map((o) => [o.name as string, o]));
    const mal = inds.get("c2.evil-host.test")!;
    expect(mal.indicator_types).toEqual(["malicious-activity"]);
    expect(mal.confidence).toBe(85);
    expect(mal.labels).toEqual(
      expect.arrayContaining(["adtripwire:malicious", "role:c2", "campaign:synthetic"]),
    );
    const surv = inds.get("tracker-one.test")!;
    expect(surv.indicator_types).toEqual(["attribution"]);
    expect(surv.labels).toContain("adtripwire:surveillance");
    expect(inds.get("corp.contextual.test")!.indicator_types).toEqual(["unknown"]);
    expect(inds.get("corp.contextual.test")!.confidence).toBe(30);
    const win = inds.get("windowed.test")!;
    expect(win.valid_from).toBe("2026-10-15T00:00:00.000Z");
    expect(win.valid_until).toBe("2027-01-31T23:59:59.999Z");
    expect(surv.valid_from).toBe("2026-10-15T00:00:00.000Z");
    expect(surv).not.toHaveProperty("valid_until");
    expect((surv.external_references as Array<{ url?: string }>)[0]!.url).toBe(
      "https://report.example.test/adfection",
    );
  });

  it("is deterministic across exports (ids and bytes)", () => {
    const again = indicatorSetToStix(makeSet(), { producedAt: new Date("2030-01-01T00:00:00Z") });
    expect(JSON.stringify(again)).toBe(JSON.stringify(bundle));
    expect(byType(bundle, "indicator").map((o) => o.id)).toContain(
      stixIndicatorId("syn-set", "s-1"),
    );
  });

  it("rejects malformed identity overrides", () => {
    expect(() => indicatorSetToStix(set, { producedAt, identityId: "identity--nope" })).toThrow();
  });
});

describe("detectionsToStix", () => {
  const set = makeSet();
  const bundle = detectionsToStix([makeDetection()], makeEvents(), [set], { producedAt });
  const text = JSON.stringify(bundle);

  it("produces a well-formed, self-contained bundle", () => {
    checkCommon(bundle);
  });

  it("has observed-data, sightings per known indicator, a note and a report referencing everything", () => {
    const od = byType(bundle, "observed-data");
    expect(od).toHaveLength(1);
    expect(od[0]!.number_observed).toBe(3);
    expect(od[0]!.first_observed).toBe("2026-09-21T14:13:20.000Z");
    expect(od[0]!.last_observed).toBe("2026-09-21T14:13:20.400Z");
    const sightings = byType(bundle, "sighting");
    expect(sightings.map((s) => s.sighting_of_ref).sort()).toEqual(
      [stixIndicatorId("syn-set", "s-2"), stixIndicatorId("syn-set", "s-4")].sort(),
    );
    for (const s of sightings) expect(s.observed_data_refs).toEqual([od[0]!.id]);
    const note = byType(bundle, "note")[0]!;
    const content = note.content as string;
    expect(content).toContain("Observed traffic to documented infrastructure");
    expect(content).toContain("Confidence rationale: Exact hostname match");
    expect(content).toContain(
      "Alternative explanations:\n- The domain may have changed ownership.",
    );
    expect(content).toContain("Limitations:\n- Browser-only visibility.");
    expect(content).toContain("not a probability of compromise");
    expect(content).toContain("unknown-id");
    const reports = byType(bundle, "report");
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.report_types).toEqual(["threat-report"]);
    expect(report.description as string).toContain(EXPORT_DISCLAIMER);
    expect(report.published).toBe("2026-11-02T12:00:00.000Z");
    const others = bundle.objects
      .filter((o) => o.id !== report.id)
      .map((o) => o.id)
      .sort();
    expect([...(report.object_refs as string[])].sort()).toEqual(others);
  });

  it("emits SCOs only from hostnames and sanitized path patterns", () => {
    const urls = byType(bundle, "url")
      .map((o) => o.value as string)
      .sort();
    expect(urls).toEqual([
      "https://c2.evil-host.test/u/%7Bid%7D/track",
      "https://shared-bucket.cdn.test/Campaign_Path/%7Bhash%7D.js",
    ]);
    const domains = byType(bundle, "domain-name").map((o) => o.value);
    expect(domains.sort()).toEqual(["c2.evil-host.test", "shared-bucket.cdn.test"]);
  });

  it("never carries query values, browsing context or initiators", () => {
    expect(text).not.toContain("token=");
    expect(text).not.toContain("abc123secret");
    expect(text).not.toContain("secretparam");
    expect(text).not.toContain(TOP_SITE);
    expect(text).not.toContain(INITIATOR);
    expect(text).not.toContain("adframe.cdn.test");
    for (const o of byType(bundle, "url")) expect(o.value as string).not.toMatch(/[?=&#]/);
  });

  it("strict profile pseudonymises non-subject hostnames in free text", () => {
    const det = makeDetection({ summary: `Observed traffic while viewing ${TOP_SITE}` });
    const strict = JSON.stringify(
      detectionsToStix([det], makeEvents(), [set], { producedAt, profile: "strict", salt: "s" }),
    );
    expect(strict).not.toContain(TOP_SITE);
    const dflt = JSON.stringify(detectionsToStix([det], makeEvents(), [set], { producedAt }));
    expect(dflt).toContain(TOP_SITE); // default profile mirrors the evidence export
  });

  it("is deterministic for the same input and producedAt", () => {
    const again = detectionsToStix([makeDetection()], makeEvents(), [makeSet()], { producedAt });
    expect(JSON.stringify(again)).toBe(text);
  });

  it("handles behavioural detections with no indicator matches and an empty list", () => {
    const b = detectionsToStix(
      [makeDetection({ matchedIndicatorIds: [], detectionId: "det-2" })],
      makeEvents(),
      [set],
      { producedAt },
    );
    checkCommon(b);
    expect(byType(b, "sighting")).toHaveLength(0);
    const empty = detectionsToStix([], [], [], { producedAt });
    checkCommon(empty);
    expect((byType(empty, "report")[0]!.object_refs as string[]).length).toBeGreaterThan(0);
  });
});

describe("parseDomainPattern", () => {
  it("accepts single equalities and ORs", () => {
    expect(parseDomainPattern("[domain-name:value = 'a.test']")).toEqual(["a.test"]);
    expect(
      parseDomainPattern("[domain-name:value = 'a.test' OR domain-name:value = 'b.test']"),
    ).toEqual(["a.test", "b.test"]);
    expect(
      parseDomainPattern("[domain-name:value = 'a.test'] OR [domain-name:value = 'b.test']"),
    ).toEqual(["a.test", "b.test"]);
  });
  it("rejects everything else", () => {
    for (const p of [
      "[ipv4-addr:value = '192.0.2.1']",
      "[domain-name:value = 'a.test' AND domain-name:value = 'b.test']",
      "[domain-name:value != 'a.test']",
      "[domain-name:value = 'a.test'] WITHIN 5 SECONDS",
      "[url:value MATCHES '^https?://a']",
      "[domain-name:value = 'a.test'",
      "",
    ]) {
      expect(parseDomainPattern(p), p).toBeNull();
    }
  });
});

describe("stixToIndicatorSet", () => {
  const opts = { setId: "imported", name: "Imported", license: "CC0-1.0" };

  it("round-trips an exported set (hostnames, classifications, types)", () => {
    const set = makeSet();
    const r = stixToIndicatorSet(
      JSON.parse(JSON.stringify(indicatorSetToStix(set, { producedAt }))),
      opts,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const expected = set.indicators
      .filter((x) => x.enabled && (x.indicatorType === "domain" || x.indicatorType === "hostname"))
      .map((x) => [x.indicator, x.classification, x.indicatorType, x.confidence].join("|"))
      .sort();
    const got = r.set.indicators
      .map((x) => [x.indicator, x.classification, x.indicatorType, x.confidence].join("|"))
      .sort();
    expect(got).toEqual(expected);
    expect(r.warnings.join("\n")).toMatch(/unsupported pattern \(url\)/);
    const win = r.set.indicators.find((x) => x.indicator === "windowed.test")!;
    expect(win.validTo).toBe("2027-01-31");
    expect(win.role).toBe("tracking");
    expect(win.campaign).toBe("synthetic");
    expect(r.set.meta.synthetic).toBe(false);
    expect(r.set.meta.sources[0]!.name).toBe("AdTripwire");
  });

  const indicator = (value: string, id: string) => ({
    type: "indicator",
    spec_version: "2.1",
    id,
    created: "2026-10-18T00:00:00.000Z",
    modified: "2026-10-18T00:00:00.000Z",
    pattern: `[domain-name:value = '${value}']`,
    pattern_type: "stix",
    valid_from: "2026-10-18T00:00:00.000Z",
    indicator_types: ["malicious-activity"],
  });

  it("rejects a shared-hosting apex via the validator", () => {
    const alone = stixToIndicatorSet(
      { type: "bundle", id: "bundle--x", objects: [indicator("cloudfront.net", "indicator--1")] },
      opts,
    );
    expect(alone.ok).toBe(false);
    if (!alone.ok) expect(alone.errors.join("\n")).toMatch(/cloudfront\.net.*too broad/);

    const mixed = stixToIndicatorSet(
      {
        type: "bundle",
        id: "bundle--x",
        objects: [
          indicator("cloudfront.net", "indicator--1"),
          indicator("d0abc.cloudfront.net", "indicator--2"),
        ],
      },
      opts,
    );
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.set.indicators.map((x) => x.indicator)).toEqual(["d0abc.cloudfront.net"]);
    expect(mixed.warnings.join("\n")).toMatch(/Rejected cloudfront\.net/);
    expect(mixed.set.indicators[0]!.classification).toBe("malicious");
    expect(mixed.set.indicators[0]!.sourceUrl).toBe("urn:stix:indicator--2");
    expect(mixed.set.indicators[0]!.confidence).toBe("low");
  });

  it("rejects non-bundles and bad JSON text", () => {
    expect(stixToIndicatorSet("{nope", opts).ok).toBe(false);
    expect(stixToIndicatorSet({ type: "indicator" }, opts).ok).toBe(false);
    expect(stixToIndicatorSet({ type: "bundle", objects: "x" }, opts).ok).toBe(false);
  });

  it("imports the trimmed Zero-Breach-shaped fixture", () => {
    const raw = readFileSync(
      new URL("./__fixtures__/zero-breach-trimmed.stix.json", import.meta.url),
      "utf8",
    );
    const r = stixToIndicatorSet(raw, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.set.indicators).toHaveLength(4);
    expect(r.set.indicators.every((x) => x.indicatorType === "domain")).toBe(true);
    expect(r.set.indicators.every((x) => x.classification === "malicious")).toBe(true);
    const old = r.set.indicators.find((x) => x.indicator === "old-campaign.test")!;
    expect(old.confidence).toBe("medium");
    expect(old.role).toBe("historical");
    expect(old.source).toBe("adint-scan IOC set");
    expect(old.sourceUrl).toBe("https://intel.example.test/candiru");
    expect(old.firstReported).toBe("2026-10-18");
    expect(r.warnings).toEqual([
      expect.stringMatching(/^Skipped 2 indicator\(s\): unsupported pattern \(ipv4-addr\)/),
      expect.stringMatching(/^Skipped 1 indicator\(s\): unsupported pattern \(file\)/),
    ]);
    expect(r.set.meta.sources).toEqual([
      {
        name: "adint-scan IOC set",
        url: "urn:stix:identity--294ec63a-c449-5439-83fb-942185697747",
        published: "2026-10-18",
      },
    ]);
    const s: IndicatorSet = r.set;
    expect(s.meta.asOf).toBe("2026-10-18");
  });
});
