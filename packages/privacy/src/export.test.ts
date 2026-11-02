import { describe, expect, it } from "vitest";
import { EXPORT_DISCLAIMER, buildEvidenceExport, serializeExport } from "./export.js";
import { pseudonymiseHostname } from "./redact.js";
import {
  AD_FRAME,
  CAPS,
  INITIATOR_HOST,
  SET_META,
  SUBJECT,
  TOP,
  makeDetection,
  makeEvent,
} from "./test-fixtures.js";

const NOW = new Date("2026-11-02T12:00:00.000Z");

function build(
  profile: "default" | "strict",
  extra: Partial<Parameters<typeof buildEvidenceExport>[0]> = {},
) {
  return buildEvidenceExport({
    productVersion: "0.1.0",
    browser: CAPS,
    rulesetVersion: "r1",
    indicatorSets: [SET_META],
    detections: [makeDetection()],
    events: [
      makeEvent(),
      makeEvent({
        eventId: "22222222-2222-4222-8222-222222222222",
        observationLimitations: ["no_response_body_access", "from_cache"],
      }),
    ],
    profile,
    now: NOW,
    salt: "fixed-salt",
    ...extra,
  });
}

describe("buildEvidenceExport", () => {
  it("has the exact disclaimer", () => {
    const expected =
      "AdTripwire records observable indicators only. Absence of detections is not evidence that a device is free of spyware. Infrastructure matches describe exposure to documented infrastructure, not confirmed compromise.";
    expect(EXPORT_DISCLAIMER).toBe(expected);
    expect(build("default").disclaimer).toBe(expected);
    expect(build("strict").disclaimer).toBe(expected);
  });

  it("fills header fields", () => {
    const out = build("default");
    expect(out.schema).toBe("adtripwire.evidence-export");
    expect(out.schemaVersion).toBe("1.0.0");
    expect(out.exportedAt).toBe("2026-11-02T12:00:00.000Z");
    expect(out.productVersion).toBe("0.1.0");
    expect(out.rulesetVersion).toBe("r1");
    expect(out.indicatorSets).toEqual([
      { id: "test-set", version: "1.0.0", asOf: "2026-01-01", license: "CC0" },
    ]);
    expect(out.redaction.profile).toBe("default");
    expect(out.redaction.hostnamesPseudonymised).toBe(false);
    expect(out.redaction.redactedFields.length).toBeGreaterThan(0);
  });

  it("defaults exportedAt to now as ISO string", () => {
    const out = build("default", { now: undefined as unknown as Date });
    expect(new Date(out.exportedAt).toISOString()).toBe(out.exportedAt);
  });

  it("de-duplicates and sorts visibility limitations, with fixed browser-limit sentences", () => {
    const out = build("default");
    const l = out.visibilityLimitations;
    expect(new Set(l).size).toBe(l.length);
    expect([...l].sort()).toEqual(l);
    expect(l.filter((s) => s.includes("Response bodies could not be read"))).toHaveLength(1);
    expect(l.some((s) => s.includes("served from cache"))).toBe(true);
    expect(l.some((s) => s.includes("outside the browser"))).toBe(true);
  });

  it("includes fixed limitations even without events", () => {
    const out = build("default", { events: [], detections: [] });
    expect(out.visibilityLimitations.length).toBeGreaterThan(0);
  });

  it("default profile keeps hostnames and reports it", () => {
    const out = build("default");
    expect(JSON.stringify(out)).toContain(TOP);
    expect(out.redaction.redactedFields).not.toContain("initiator origins");
  });

  it("strict profile pseudonymises non-subject hostnames everywhere and keeps subjects", () => {
    const out = build("strict");
    const json = JSON.stringify(out);
    // TOP is a subject of the fixture detection, so it is kept; use a detection without it.
    expect(json).toContain(SUBJECT);
    const out2 = build("strict", { detections: [makeDetection({ subjectHostnames: [SUBJECT] })] });
    const json2 = JSON.stringify(out2);
    for (const h of [TOP, AD_FRAME, INITIATOR_HOST, "redirect.other-tracker.io"])
      expect(json2).not.toContain(h);
    expect(json2).toContain(pseudonymiseHostname(TOP, "fixed-salt"));
    expect(json2).toContain(SUBJECT);
    expect(out2.redaction.profile).toBe("strict");
    expect(out2.redaction.hostnamesPseudonymised).toBe(true);
    expect(out2.redaction.redactedFields).toContain("initiator origins");
    expect(out2.events.every((e) => !("tabId" in e) && !("initiatorOrigin" in e))).toBe(true);
  });

  it("never includes the salt", () => {
    const out = build("strict", { salt: "super-secret-salt-value" });
    expect(serializeExport(out)).not.toContain("super-secret-salt-value");
  });

  it("generates a random salt when none given (different runs differ, salt not exported)", () => {
    const detections = [makeDetection({ subjectHostnames: [SUBJECT] })];
    const a = build("strict", { salt: undefined as unknown as string, detections });
    const b = build("strict", { salt: undefined as unknown as string, detections });
    expect(a.events[0]!.frameContext.topHostname).toMatch(/^h-[0-9a-f]{10}$/);
    expect(a.events[0]!.frameContext.topHostname).not.toBe(b.events[0]!.frameContext.topHostname);
  });

  it("does not mutate inputs", () => {
    const events = [makeEvent()];
    const detections = [makeDetection()];
    const snap = JSON.stringify({ events, detections });
    build("strict", { events, detections });
    expect(JSON.stringify({ events, detections })).toBe(snap);
  });

  for (const profile of ["default", "strict"] as const) {
    it(`${profile}: no '@', 'password' or '?x=value' pattern anywhere in the serialized export`, () => {
      const dirty = makeDetection({
        evidence: [
          {
            eventIds: [],
            observed: "Saw https://user:password@noas.mtrtb.com/getAd?idfa=ABCDEF123456&x=y#frag",
            kind: "observed",
          },
        ],
      });
      const s = serializeExport(build(profile, { detections: [dirty] }));
      expect(s).not.toContain("@");
      expect(s.toLowerCase()).not.toContain("password");
      expect(s).not.toMatch(/\?[^"\s=&]+=/);
      expect(s).not.toContain("ABCDEF123456");
    });
  }
});

describe("serializeExport", () => {
  it("is stable: identical input produces identical output", () => {
    for (const profile of ["default", "strict"] as const) {
      expect(serializeExport(build(profile))).toBe(serializeExport(build(profile)));
    }
  });

  it("is independent of object key insertion order", () => {
    const out = build("default");
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(out).reverse())));
    expect(serializeExport(reordered)).toBe(serializeExport(out));
  });

  it("uses 2-space indentation and round-trips", () => {
    const out = build("default");
    const s = serializeExport(out);
    expect(s.startsWith('{\n  "')).toBe(true);
    expect(JSON.parse(s)).toEqual(JSON.parse(JSON.stringify(out)));
  });
});
