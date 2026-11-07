import { describe, expect, it } from "vitest";
import { IndicatorMatcher } from "@adtripwire/indicators";
import { DetectionEngine, type EngineSnapshot } from "./engine.js";
import { MemoryExposureStore } from "./exposure.js";
import {
  ALL_CAPS,
  Harness,
  assertConservativeLanguage,
  SYNTHETIC_SET,
  T0,
  WINDOW_MS,
  ev,
  ids,
  settings,
  stage,
} from "./__test__/fixtures.js";

const NOAS_PARAMS = ["idfa", "sourceId", "dom", "page", "country", "os"];
const HIDDEN_IFRAME = ["js.iframe_create", "js.iframe_1x1", "js.script_inject"];

describe("DetectionEngine scenarios", () => {
  it("1. ordinary ad load produces no detections", () => {
    const h = new Harness();
    const start = ev({
      host: "ads.synthetic-benign.test",
      path: "/serve.js",
      params: ["w", "h", "slot"],
      tp: ["tracking_ad"],
    });
    const out = h.ingestAll([start, stage(start, "request_completed", { size: 2048 })]);
    expect(out).toEqual([]);
  });

  it("2. benign fingerprinting classification alone produces no detections", () => {
    const h = new Harness();
    const out = h.ingestAll([ev({ host: "fp.synthetic-benign.test", tp: ["fingerprinting"] })]);
    expect(out).toEqual([]);
  });

  it("3. contact with a synthetic C2 yields one malicious-contact detection", () => {
    const h = new Harness();
    const { detections, event } = h.ingest(
      ev({ host: "c2.synthetic-adfection.test", type: "xmlhttprequest" }),
    );
    expect(ids(detections)).toEqual(["known_infra.malicious_contact"]);
    const d = detections[0]!;
    expect(d.severity).toBe("elevated");
    expect(d.confidence).toBe("high");
    expect(d.confidenceRationale).toMatch(/attribution is not the same as personal targeting/i);
    expect(d.matchedIndicatorIds).toEqual(["syn-0001"]);
    expect(event.matchedIndicators).toEqual(["syn-0001"]);
    expect(event.matchedRules).toEqual(["known_infra.malicious_contact"]);
    expect(d.dedupKey).toMatch(/^[0-9a-f]{8}$/);
    expect(d.tabId).toBe(1);
  });

  it("disabled indicators never match", () => {
    const h = new Harness();
    expect(h.ingestAll([ev({ host: "disabled.synthetic-adfection.test" })])).toEqual([]);
  });

  it("does not mutate the input event and derives a correlation id", () => {
    const h = new Harness();
    const input = ev({ host: "c2.synthetic-adfection.test" });
    const frozen = JSON.stringify(input);
    const { event } = h.ingest(input);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(event).not.toBe(input);
    const insp = ev({
      host: "cdn.synthetic-benign.test",
      eventType: "response_inspected",
      tp: ["tracking"],
      inspection: { markers: ["js.eval"] },
    });
    h.ingest(insp);
    insp.responseInspection!.markers.push("js.mutated");
    insp.frameContext.urlClassification!.thirdParty.push("tracking_ad");
    const stored = h.engine.window.recent().find((x) => x.eventId === insp.eventId)!;
    expect(stored.responseInspection!.markers).toEqual(["js.eval"]);
    expect(stored.frameContext.urlClassification!.thirdParty).toEqual(["tracking"]);
    expect(event.correlationId).toBe("tab:1");
    const noTab = ev({ host: "x.synthetic-benign.test", rid: "abc" });
    delete (noTab as { tabId?: number }).tabId;
    expect(h.ingest(noTab).event.correlationId).toBe("req:abc");
  });

  describe("4. NOAS request", () => {
    it("fires surveillance contact (elevated, noas) and noas_request", () => {
      const h = new Harness();
      const { detections } = h.ingest(
        ev({ host: "noas.synthetic-adfection.test", path: "/getAd", params: NOAS_PARAMS }),
      );
      // idfa + country + os also make the request identifier-rich (informational profiling context).
      expect(ids(detections)).toEqual([
        "ad_delivery.noas_request",
        "known_infra.surveillance_contact",
        "profiling.identifier_rich_request",
      ]);
      expect(
        detections.find((d) => d.ruleId === "profiling.identifier_rich_request")!.severity,
      ).toBe("informational");
      const s = detections.find((d) => d.ruleId === "known_infra.surveillance_contact")!;
      expect(s.severity).toBe("elevated");
      expect(s.summary).toMatch(/NOAS/);
      const n = detections.find((d) => d.ruleId === "ad_delivery.noas_request")!;
      expect(n.severity).toBe("suspicious");
      expect(n.confidence).toBe("medium");
      expect(n.summary).toMatch(/syn-0003/);
    });

    it("empty response is informational", () => {
      const h = new Harness();
      const start = ev({
        host: "noas.synthetic-adfection.test",
        path: "/cplatform/getAd",
        params: NOAS_PARAMS,
      });
      h.ingest(start);
      const { detections } = h.ingest(stage(start, "request_completed", { size: 0 }));
      expect(ids(detections)).toEqual(["ad_delivery.noas_selective_response"]);
      expect(detections[0]!.severity).toBe("informational");
      expect(detections[0]!.summary).toMatch(/not selection/);
    });

    it("4 KB JavaScript response is elevated", () => {
      const h = new Harness();
      const start = ev({
        host: "noas.synthetic-adfection.test",
        path: "/getAd",
        params: NOAS_PARAMS,
      });
      h.ingest(start);
      const { detections } = h.ingest(
        stage(start, "response_inspected", {
          inspection: { observedBytes: 4096, contentType: "text/javascript" },
        }),
      );
      const d = detections.find((x) => x.ruleId === "ad_delivery.noas_selective_response")!;
      expect(d.severity).toBe("elevated");
      expect(d.confidence).toBe("medium");
    });

    it("path matching is exact and case-sensitive", () => {
      const h = new Harness();
      for (const path of ["/getad", "/getAdvanced", "/x/getAd", "/cplatform/getAd/extra"]) {
        const out = h.ingestAll([
          ev({ host: "ads.synthetic-benign.test", path, params: NOAS_PARAMS }),
        ]);
        expect(out.filter((d) => d.ruleId.startsWith("ad_delivery"))).toEqual([]);
      }
      const ok = h.ingestAll([
        ev({ host: "ads2.synthetic-benign.test", path: "/getAd", params: ["idfa"] }),
      ]);
      expect(ids(ok)).toEqual(["ad_delivery.noas_request"]);
    });

    it("requires an identifier-like parameter", () => {
      const h = new Harness();
      expect(
        h.ingestAll([
          ev({ host: "ads.synthetic-benign.test", path: "/getAd", params: ["w", "h"] }),
        ]),
      ).toEqual([]);
    });
  });

  describe("5. JavaScript technique rules", () => {
    it("hidden iframe markers are suspicious", () => {
      const h = new Harness();
      const { detections } = h.ingest(
        ev({
          host: "cdn.synthetic-benign.test",
          eventType: "response_inspected",
          inspection: { markers: HIDDEN_IFRAME },
        }),
      );
      const d = detections.find((x) => x.ruleId === "js.hidden_iframe_injection")!;
      expect(d.severity).toBe("suspicious");
      expect(d.confidence).toBe("medium");
    });

    it("two AdFection SDK markers are elevated/high", () => {
      const h = new Harness();
      const { detections } = h.ingest(
        ev({
          host: "cdn.synthetic-benign.test",
          eventType: "response_inspected",
          inspection: { markers: ["js.adfection_sdk_auth", "js.adfection_sdk_ready"] },
        }),
      );
      const d = detections.find((x) => x.ruleId === "js.adfection_sdk_markers")!;
      expect(d.severity).toBe("elevated");
      expect(d.confidence).toBe("high");
      expect(d.summary).toMatch(/documented by Confiant/);
    });

    it("a single marker never exceeds informational", () => {
      const h = new Harness();
      const singles = [
        "js.adfection_sdk_auth",
        "js.iframe_create",
        "js.cookie_read",
        "js.new_function",
        "js.error_stack_trap",
        "js.doh_cloudflare",
      ];
      for (const m of singles) {
        const { detections } = h.ingest(
          ev({
            host: `s-${m.slice(3)}.synthetic-benign.test`,
            eventType: "response_inspected",
            inspection: { markers: [m] },
          }),
        );
        for (const d of detections) expect(d.severity).toBe("informational");
      }
    });
  });

  describe("6. AdFection chain correlation", () => {
    function chain(h: Harness, gap: number): ReturnType<Harness["ingest"]> {
      const s1 = ev({
        host: "noas.synthetic-adfection.test",
        path: "/getAd",
        params: NOAS_PARAMS,
        t: T0,
      });
      h.ingest(s1);
      h.ingest(
        stage(s1, "response_inspected", {
          t: T0 + 1000,
          inspection: { markers: HIDDEN_IFRAME, contentType: "application/javascript" },
        }),
      );
      return h.ingest(
        ev({
          host: "validator.synthetic-adfection.test",
          type: "xmlhttprequest",
          t: T0 + 1000 + gap,
        }),
      );
    }

    it("correlates within the window", () => {
      const h = new Harness();
      const { detections } = chain(h, 5000);
      const c = detections.find((d) => d.ruleId === "correlation.adfection_chain")!;
      expect(c).toBeDefined();
      expect(c.severity).toBe("high_priority");
      expect(c.confidence).toBe("medium");
      expect(c.confidenceRationale).toMatch(/temporal proximity does not prove causation/i);
      const kinds = new Set(c.evidence.map((e) => e.kind));
      expect(kinds).toEqual(new Set(["observed", "inferred"]));
      expect(c.eventIds).toHaveLength(3);
      expect(
        detections.some((d) => d.ruleId === "correlation.suspicious_js_then_malicious_contact"),
      ).toBe(false);
    });

    it("correlates via a plain non-empty JS response from a /getAd request (no markers)", () => {
      const h = new Harness();
      const s1 = ev({
        host: "ads.synthetic-benign.test",
        path: "/getAd",
        params: NOAS_PARAMS,
        t: T0,
      });
      h.ingest(s1);
      h.ingest(
        stage(s1, "response_inspected", {
          t: T0 + 800,
          inspection: { markers: [], contentType: "application/javascript" },
        }),
      );
      const { detections } = h.ingest(ev({ host: "c2.synthetic-adfection.test", t: T0 + 4000 }));
      const c = detections.find((d) => d.ruleId === "correlation.adfection_chain")!;
      expect(c).toBeDefined();
      // s1 -> s2 share a request id: that link is observed; s2 -> s3 is inferred.
      const links = c.evidence.filter((e) => e.observed.startsWith("Link"));
      expect(links.map((l) => l.kind)).toEqual(["observed", "inferred"]);
    });

    it("correlates via a JS response from a NOAS-role host on a non-/getAd path", () => {
      const h = new Harness();
      const s1 = ev({ host: "noas.synthetic-adfection.test", path: "/loader.js", t: T0 });
      h.ingest(s1);
      h.ingest(
        stage(s1, "response_inspected", {
          t: T0 + 800,
          inspection: { markers: [], contentType: "application/javascript" },
        }),
      );
      const { detections } = h.ingest(ev({ host: "c2.synthetic-adfection.test", t: T0 + 4000 }));
      expect(detections.some((d) => d.ruleId === "correlation.adfection_chain")).toBe(true);
    });

    it("an empty or merely sized NOAS response does not complete the chain", () => {
      const h = new Harness();
      const s1 = ev({
        host: "noas.synthetic-adfection.test",
        path: "/getAd",
        params: NOAS_PARAMS,
        t: T0,
      });
      h.ingest(s1);
      h.ingest(stage(s1, "request_completed", { t: T0 + 500, size: 4096 }));
      h.ingest(
        stage(s1, "response_inspected", {
          t: T0 + 600,
          inspection: { markers: [], observedBytes: 0, contentType: "application/javascript" },
        }),
      );
      const { detections } = h.ingest(ev({ host: "c2.synthetic-adfection.test", t: T0 + 4000 }));
      expect(detections.some((d) => d.ruleId.startsWith("correlation."))).toBe(false);
    });

    it("does not correlate when the gap exceeds the window", () => {
      const h = new Harness();
      const { detections } = chain(h, WINDOW_MS + 1);
      expect(detections.some((d) => d.ruleId.startsWith("correlation."))).toBe(false);
      expect(ids(detections)).toEqual(["known_infra.malicious_contact"]);
    });

    it("does not correlate across tabs", () => {
      const h = new Harness();
      const s1 = ev({
        host: "noas.synthetic-adfection.test",
        path: "/getAd",
        params: NOAS_PARAMS,
        tab: 1,
      });
      h.ingest(s1);
      h.ingest(stage(s1, "response_inspected", { inspection: { markers: HIDDEN_IFRAME } }));
      const { detections } = h.ingest(
        ev({ host: "c2.synthetic-adfection.test", tab: 2, t: T0 + 2000 }),
      );
      expect(detections.some((d) => d.ruleId.startsWith("correlation."))).toBe(false);
    });

    it("suspicious JS then malicious contact without a NOAS step", () => {
      const h = new Harness();
      h.ingest(
        ev({
          host: "cdn.synthetic-benign.test",
          eventType: "response_inspected",
          inspection: {
            markers: ["js.colocated_cookie_exfil", "js.cookie_read", "js.cookie_tilde_join"],
          },
        }),
      );
      const { detections } = h.ingest(ev({ host: "c2.synthetic-adfection.test", t: T0 + 3000 }));
      const d = detections.find(
        (x) => x.ruleId === "correlation.suspicious_js_then_malicious_contact",
      )!;
      expect(d.severity).toBe("high_priority");
      expect(d.confidence).toBe("medium");
      expect(detections.some((x) => x.ruleId === "correlation.adfection_chain")).toBe(false);
    });

    it("NOAS request then loader frame is elevated", () => {
      const h = new Harness();
      h.ingest(ev({ host: "noas.synthetic-adfection.test", path: "/getAd", params: NOAS_PARAMS }));
      const { detections } = h.ingest(
        ev({
          host: "d111.synthetic-cdn.test",
          path: "/iframe",
          params: ["impid"],
          type: "sub_frame",
          depth: 1,
          t: T0 + 1500,
        }),
      );
      const d = detections.find((x) => x.ruleId === "correlation.noas_then_hidden_frame")!;
      expect(d.severity).toBe("elevated");
      expect(d.evidence.some((e) => e.kind === "inferred")).toBe(true);
    });
  });

  it("7. dedup: identical event twice increments occurrenceCount", () => {
    const h = new Harness();
    const e = ev({ host: "c2.synthetic-adfection.test" });
    const first = h.ingest(e);
    expect(first.detections).toHaveLength(1);
    const second = h.ingest({ ...e, eventId: "evt-dup", timestamp: e.timestamp + 10 });
    expect(second.detections).toEqual([]);
    expect(second.updated).toHaveLength(1);
    expect(second.updated[0]!.occurrenceCount).toBe(2);
    expect(second.updated[0]!.detectionId).toBe(first.detections[0]!.detectionId);
    expect(second.event.matchedRules).toEqual(["known_infra.malicious_contact"]);
    // After the window passes the detection is raised afresh.
    const third = h.ingest({
      ...e,
      eventId: "evt-late",
      timestamp: e.timestamp + WINDOW_MS + 1000,
    });
    expect(third.detections).toHaveLength(1);
  });

  it("8. capability gating: D rules not evaluable without body inspection", () => {
    const caps = ALL_CAPS.filter((c) => c !== "response_body_inspection");
    const h = new Harness({ caps });
    const status = h.engine.listRules();
    const jsRules = status.filter(
      (s) => s.definition.category === "javascript_technique" && s.definition.id.startsWith("js."),
    );
    expect(jsRules.length).toBeGreaterThanOrEqual(6);
    for (const s of jsRules) {
      expect(s.evaluable).toBe(false);
      expect(s.missingCapabilities).toContain("response_body_inspection");
    }
    const { detections } = h.ingest(
      ev({
        host: "cdn.synthetic-benign.test",
        eventType: "response_inspected",
        inspection: {
          markers: ["js.adfection_sdk_auth", "js.adfection_sdk_ready", ...HIDDEN_IFRAME],
        },
      }),
    );
    expect(detections.filter((d) => d.category === "javascript_technique")).toEqual([]);

    // any-of capability: selective response needs size OR body inspection
    const bare = new Harness({ caps: ["request_metadata"] });
    const sel = bare.engine
      .listRules()
      .find((s) => s.definition.id === "ad_delivery.noas_selective_response")!;
    expect(sel.evaluable).toBe(false);
    expect(sel.missingCapabilities).toEqual(
      expect.arrayContaining(["response_size", "response_body_inspection"]),
    );
    const sized = new Harness({ caps: ["request_metadata", "response_size"] });
    expect(
      sized.engine
        .listRules()
        .find((s) => s.definition.id === "ad_delivery.noas_selective_response")!.evaluable,
    ).toBe(true);
  });

  it("settings.responseInspectionEnabled=false disables body-inspection rules", () => {
    const engine = new DetectionEngine({
      matcher: new IndicatorMatcher([SYNTHETIC_SET]),
      capabilities: { browser: "firefox", capabilities: ALL_CAPS, notes: [] },
      settings: settings({ responseInspectionEnabled: false }),
      now: () => T0,
    });
    expect(
      engine
        .listRules()
        .filter((s) => s.definition.id.startsWith("js."))
        .every((s) => !s.evaluable),
    ).toBe(true);
  });

  it("9. snapshot/restore mid-chain still correlates", () => {
    const h = new Harness();
    const s1 = ev({ host: "noas.synthetic-adfection.test", path: "/getAd", params: NOAS_PARAMS });
    h.ingest(s1);
    h.ingest(
      stage(s1, "response_inspected", { t: T0 + 500, inspection: { markers: HIDDEN_IFRAME } }),
    );
    h.ingest(ev({ host: "c2.synthetic-adfection.test", t: T0 + 600, tab: 9 })); // dedup entry, other tab
    const snap = JSON.parse(JSON.stringify(h.engine.snapshot())) as EngineSnapshot;
    expect(snap.events.length).toBe(3);

    let clock = T0 + 2000;
    const restored = DetectionEngine.restore(snap, {
      matcher: new IndicatorMatcher([SYNTHETIC_SET]),
      capabilities: { browser: "firefox", capabilities: ALL_CAPS, notes: [] },
      settings: settings(),
      now: () => clock,
    });
    expect(restored.rulesetVersion).toBe(h.engine.rulesetVersion);
    const r = restored.ingest(ev({ host: "c2.synthetic-adfection.test", t: clock }));
    for (const d of [...r.detections, ...r.updated]) assertConservativeLanguage(d);
    expect(r.detections.some((d) => d.ruleId === "correlation.adfection_chain")).toBe(true);
    // dedup state survived: same subject (c2 host) is suppressed
    expect(r.detections.some((d) => d.ruleId === "known_infra.malicious_contact")).toBe(false);
    expect(
      r.updated.some(
        (d) => d.ruleId === "known_infra.malicious_contact" && d.occurrenceCount === 2,
      ),
    ).toBe(true);
    clock += 1;
  });

  it("10. window stays bounded under 20k events", () => {
    const max = 1000;
    const h = new Harness({ maxWindowEvents: max });
    for (let i = 0; i < 20000; i++) {
      h.ingest(
        ev({ host: `h${i % 500}.synthetic-benign.test`, t: T0 + i, tab: i % 50, rid: `bulk-${i}` }),
      );
    }
    expect(h.engine.window.recent().length).toBeLessThanOrEqual(max);
    expect(h.engine.window.size).toBe(max);
    const idx = h.engine.window.indexSizes;
    expect(idx.requests).toBeLessThanOrEqual(max);
    expect(idx.correlations).toBeLessThanOrEqual(50);
    expect(idx.tabs).toBeLessThanOrEqual(50);
    expect(h.engine.dedupSize).toBeLessThanOrEqual(5000);
    // time-based pruning
    h.engine.pruneWindow(T0 + 20000 + WINDOW_MS + 1);
    expect(h.engine.window.size).toBe(0);
    expect(h.engine.window.indexSizes).toEqual({ requests: 0, correlations: 0, tabs: 0 });
  });

  it("dedup map is bounded", () => {
    const h = new Harness({ maxDedupEntries: 10 });
    for (let i = 0; i < 50; i++) h.ingest(ev({ host: `x${i}.synthetic-dsp.test`, t: T0 + i }));
    expect(h.engine.dedupSize).toBeLessThanOrEqual(10);
  });

  describe("11. repeated exposure", () => {
    const day = 24 * 3600 * 1000;
    it("fires on the third distinct day", () => {
      const h = new Harness();
      const out = [0, 1, 2].flatMap(
        (d) => h.ingest(ev({ host: "sync.synthetic-tracking.test", t: T0 + d * day })).detections,
      );
      const f = out.filter((d) => d.ruleId === "exposure.repeated_surveillance_contact");
      expect(f).toHaveLength(1);
      expect(f[0]!.severity).toBe("informational");
      expect(f[0]!.summary).toMatch(/may be ordinary advertising behaviour/);
    });
    it("does not fire on two days (repeated same-day contacts ignored)", () => {
      const h = new Harness();
      const out = [0, 0.1, 0.2, 1, 1.1].flatMap(
        (d) => h.ingest(ev({ host: "sync.synthetic-tracking.test", t: T0 + d * day })).detections,
      );
      expect(out.some((d) => d.ruleId === "exposure.repeated_surveillance_contact")).toBe(false);
    });
    it("exposure store prunes days older than a cut-off and drops emptied hosts", () => {
      const s = new MemoryExposureStore();
      s.record("a", "2026-01-01");
      s.record("a", "2026-03-01");
      s.record("b", "2026-01-02");
      s.pruneBefore("2026-02-01");
      expect(s.distinctDays("a")).toBe(1);
      expect(s.distinctDays("b")).toBe(0);
      expect(s.size).toBe(1);
    });
    it("exposure store is serialisable and bounded", () => {
      const s = new MemoryExposureStore({ maxHosts: 3, maxDaysPerHost: 2 });
      s.record("a", "2026-11-01");
      s.record("a", "2026-11-02");
      s.record("a", "2026-11-03");
      expect(s.distinctDays("a")).toBe(2);
      for (const h of ["b", "c", "d"]) s.record(h, "2026-11-01");
      expect(s.size).toBe(3);
      const round = MemoryExposureStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
      expect(round.toJSON()).toEqual(s.toJSON());
      expect(
        MemoryExposureStore.fromJSON({ hosts: { x: ["not-a-day", 4] } }).distinctDays("x"),
      ).toBe(0);
    });
  });

  it("rulesetVersion format", () => {
    const h = new Harness();
    expect(h.engine.rulesetVersion).toMatch(/^22r-[0-9a-f]{8}$/);
  });

  it("13. language guard sanity: the guard rejects forbidden words", async () => {
    const { assertConservativeLanguage } = await import("./__test__/fixtures.js");
    const h = new Harness();
    const d = h.ingest(ev({ host: "c2.synthetic-adfection.test" })).detections[0]!;
    expect(() =>
      assertConservativeLanguage({ ...d, summary: "Your device is infected" }),
    ).toThrow();
    expect(() => assertConservativeLanguage({ ...d, significance: "This site is safe" })).toThrow();
    expect(() => assertConservativeLanguage(d)).not.toThrow();
  });
});

describe("dedup escalation", () => {
  it("upgrades a stored detection in place when a later re-fire has higher severity", async () => {
    const { DetectionEngine } = await import("./engine.js");
    const { IndicatorMatcher } = await import("@adtripwire/indicators");
    const { DEFAULT_SETTINGS } = await import("@adtripwire/shared");
    let now = 1_800_000_000_000;
    const engine = new DetectionEngine({
      matcher: new IndicatorMatcher([]),
      capabilities: {
        browser: "firefox",
        capabilities: [
          "request_metadata",
          "response_headers",
          "response_size",
          "response_body_inspection",
          "frame_ancestry",
          "third_party_flag",
          "url_classification",
        ],
        notes: [],
      },
      settings: DEFAULT_SETTINGS.monitoring,
      now: () => now,
    });
    const base = {
      browser: "firefox" as const,
      sensor: "webrequest" as const,
      requestId: "r1",
      tabId: 1,
      destination: {
        scheme: "https" as const,
        hostname: "noas.synthetic-generic.test",
        pathPattern: "/getAd",
        queryParamNames: ["idfa", "ipv4"],
        redacted: true,
      },
      resourceType: "script" as const,
      frameContext: {
        frameId: 4,
        parentFrameId: 0,
        ancestorHostnames: ["ad.synthetic-x.test", "pub.synthetic-y.test"],
        depth: 2,
        thirdParty: true,
      },
      matchedIndicators: [],
      matchedRules: [],
      evidenceQuality: "direct" as const,
      observationLimitations: [],
    };
    const started = engine.ingest({
      ...base,
      eventId: "e1",
      timestamp: now,
      eventType: "request_started",
      requestStatus: "started",
    });
    expect(started.detections.map((d) => d.ruleId)).toContain("ad_delivery.noas_request");
    now += 50;
    const completed = engine.ingest({
      ...base,
      eventId: "e2",
      timestamp: now,
      eventType: "request_completed",
      requestStatus: "completed",
      statusCode: 200,
      responseSizeIfObservable: 4000,
    });
    const first = completed.detections.find(
      (d) => d.ruleId === "ad_delivery.noas_selective_response",
    )!;
    expect(first.severity).toBe("suspicious");
    now += 5;
    const inspected = engine.ingest({
      ...base,
      eventId: "e3",
      timestamp: now,
      eventType: "response_inspected",
      sensor: "response-filter",
      requestStatus: "completed",
      statusCode: 200,
      responseSizeIfObservable: 4000,
      responseInspection: {
        observedBytes: 4000,
        truncated: false,
        contentType: "application/javascript",
        textDecodable: true,
        markers: ["js.iframe_create", "js.iframe_1x1"],
      },
    });
    expect(
      inspected.detections.find((d) => d.ruleId === "ad_delivery.noas_selective_response"),
    ).toBeUndefined();
    const up = inspected.updated.find((d) => d.ruleId === "ad_delivery.noas_selective_response")!;
    expect(up.detectionId).toBe(first.detectionId);
    expect(up.severity).toBe("elevated");
    expect(up.occurrenceCount).toBe(2);
    expect(up.eventIds).toContain("e2");
    expect(up.eventIds).toContain("e3");
  });
});
