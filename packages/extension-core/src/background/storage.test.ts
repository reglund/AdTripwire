import { beforeEach, describe, expect, it } from "vitest";
import type { Detection, NormalizedEvent } from "@adtripwire/shared";
import { DEFAULT_SETTINGS } from "@adtripwire/shared";
import { LocalStore, mergeSettings } from "./storage.js";

/** Minimal in-memory browser.storage mock. */
function installBrowserMock() {
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  const area = (m: Map<string, unknown>) => ({
    async get(keys?: string | string[]) {
      const out: Record<string, unknown> = {};
      const list = keys === undefined ? Array.from(m.keys()) : Array.isArray(keys) ? keys : [keys];
      for (const k of list) if (m.has(k)) out[k] = structuredClone(m.get(k));
      return out;
    },
    async set(obj: Record<string, unknown>) {
      for (const [k, v] of Object.entries(obj)) m.set(k, structuredClone(v));
    },
    async clear() {
      m.clear();
    },
  });
  (globalThis as unknown as { browser: unknown }).browser = {
    storage: { local: area(local), session: area(session) },
  };
  return { local, session };
}

const ev = (id: string, ts: number): NormalizedEvent => ({
  eventId: id,
  timestamp: ts,
  browser: "firefox",
  sensor: "synthetic",
  eventType: "request_started",
  destination: {
    scheme: "https",
    hostname: "x.synthetic.test",
    pathPattern: "/",
    queryParamNames: [],
    redacted: false,
  },
  frameContext: { frameId: 0, parentFrameId: -1, ancestorHostnames: [], depth: 0 },
  requestStatus: "started",
  matchedIndicators: [],
  matchedRules: [],
  evidenceQuality: "direct",
  observationLimitations: [],
});
const det = (id: string, ts: number, eventIds: string[]): Detection => ({
  detectionId: id,
  timestamp: ts,
  firstEventTimestamp: ts,
  ruleId: "r",
  ruleVersion: "1.0.0",
  ruleName: "r",
  category: "known_infrastructure",
  severity: "elevated",
  confidence: "high",
  confidenceRationale: "",
  summary: "",
  significance: "",
  evidence: [],
  eventIds,
  matchedIndicatorIds: [],
  missingVisibility: [],
  alternativeExplanations: [],
  recommendedActions: [],
  limitations: [],
  references: [],
  dedupKey: id,
  occurrenceCount: 1,
  subjectHostnames: ["x.synthetic.test"],
});

describe("LocalStore", () => {
  let mock: ReturnType<typeof installBrowserMock>;
  beforeEach(() => {
    mock = installBrowserMock();
  });

  it("persists detections with only referenced events and survives reload", async () => {
    const s = new LocalStore();
    await s.load();
    s.addDetection(det("d1", 1000, ["e1"]), [ev("e1", 999), ev("e1", 999)]);
    await s.flush();
    const s2 = new LocalStore();
    await s2.load();
    expect(s2.listDetections().map((d) => d.detectionId)).toEqual(["d1"]);
    expect(s2.getEvents(["e1", "missing"]).length).toBe(1);
  });

  it("applies retention by age, count, and removes orphaned events", async () => {
    const s = new LocalStore();
    await s.load();
    const day = 86_400_000;
    const now = 100 * day;
    s.addDetection(det("old", now - 10 * day, ["e-old"]), [ev("e-old", now - 10 * day)]);
    for (let i = 0; i < 60; i++)
      s.addDetection(det(`d${i}`, now - i * 1000, [`e${i}`]), [ev(`e${i}`, now - i * 1000)]);
    const removed = s.applyRetention(now, {
      detectionRetentionDays: 7,
      maxDetections: 50,
      maxEvents: 500,
    });
    expect(removed.removedDetections).toBe(11);
    expect(s.listDetections().length).toBe(50);
    expect(s.getEvents(["e-old"]).length).toBe(0);
    expect(s.allEvents().length).toBe(50);
  });

  it("clamps settings patches and ignores unknown keys", async () => {
    const s = new LocalStore();
    await s.load();
    const next = await s.updateSettings({
      detectionRetentionDays: 9999,
      enabled: false,
      correlationWindowMs: 1,
    } as never);
    expect(next.retention.detectionRetentionDays).toBe(365);
    expect(next.monitoring.enabled).toBe(false);
    expect(next.monitoring.correlationWindowMs).toBe(30_000);
    expect(mock.local.get("settings")).toEqual(next);
  });

  it("deleteAll wipes data but keeps settings", async () => {
    const s = new LocalStore();
    await s.load();
    await s.updateSettings({ enabled: false });
    s.addDetection(det("d1", 1, ["e1"]), [ev("e1", 1)]);
    await s.flush();
    mock.session.set("engineSnapshot", { x: 1 });
    await s.deleteAll();
    expect(s.listDetections()).toEqual([]);
    expect(mock.local.has("detections")).toBe(false);
    expect(mock.session.size).toBe(0);
    expect(
      (mock.local.get("settings") as { monitoring: { enabled: boolean } }).monitoring.enabled,
    ).toBe(false);
  });

  it("mergeSettings fills defaults for partial/corrupt stored values", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(
      mergeSettings({ monitoring: { enabled: false } }).monitoring.responseInspectionMaxBytes,
    ).toBe(DEFAULT_SETTINGS.monitoring.responseInspectionMaxBytes);
  });
});

describe("LocalStore Phase 4: imported sets and notes", () => {
  const set = (id: string) => ({
    meta: {
      id,
      name: id,
      version: "1",
      asOf: "2026-11-02",
      license: "CC0",
      synthetic: false,
      sources: [],
    },
    indicators: [],
  });
  it("adds, toggles, removes imported sets and keeps them across deleteAll", async () => {
    installBrowserMock();
    const s = new LocalStore();
    await s.load();
    await s.addImportedSet({ set: set("a"), enabled: true, importedAt: 1, format: "adtripwire" });
    await s.addImportedSet({ set: set("b"), enabled: false, importedAt: 2, format: "stix" });
    expect(s.listImportedSets().map((r) => r.set.meta.id)).toEqual(["a", "b"]);
    expect(await s.setImportedSetEnabled("b", true)).toBe(true);
    expect(await s.setImportedSetEnabled("zzz", true)).toBe(false);
    await s.deleteAll();
    const s2 = new LocalStore();
    await s2.load();
    expect(s2.listImportedSets().length).toBe(2);
    expect(await s2.removeImportedSet("a")).toBe(true);
    expect(s2.listImportedSets().map((r) => r.set.meta.id)).toEqual(["b"]);
  });
  it("stores notes, trims them, drops empty ones and prunes with retention", async () => {
    installBrowserMock();
    const s = new LocalStore();
    await s.load();
    s.addDetection(det("d1", 5_000_000_000_000, ["e1"]), [ev("e1", 5_000_000_000_000)]);
    await s.setNote("d1", "x".repeat(5000), 10);
    expect(s.getNote("d1")?.note.length).toBe(4000);
    await s.setNote("d1", "   ", 11);
    expect(s.getNote("d1")).toBeUndefined();
    await s.setNote("d1", "keep", 12);
    s.applyRetention(5_000_000_000_000 + 30 * 86_400_000, {
      detectionRetentionDays: 7,
      maxDetections: 50,
      maxEvents: 500,
    });
    expect(s.getNote("d1")).toBeUndefined();
  });
});
