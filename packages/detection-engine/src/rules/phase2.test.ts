import { describe, expect, it } from "vitest";
import type { IndicatorSet, NormalizedEvent } from "@adtripwire/shared";
import { IndicatorMatcher } from "@adtripwire/indicators";
import { lineageRelation } from "./correlation-common.js";
import {
  Harness,
  PAGE_CAPS,
  SYNTHETIC_SET,
  T0,
  ev,
  ids,
  settings,
  sig,
} from "../__test__/fixtures.js";
import { DetectionEngine } from "../engine.js";

const NOAS_PARAMS = ["idfa", "sourceId", "dom", "page", "country", "os"];
const SCRIPT = ["js.iframe_create", "js.iframe_1x1", "js.script_inject"];

/** Ad frame 5 under the top document; frame 9 nested inside frame 5; frame 7 a sibling of 5. */
const F5 = { depth: 1, frameId: 5, parentFrameId: 0, ancestors: [0] };
const F9 = { depth: 2, frameId: 9, parentFrameId: 5, ancestors: [5, 0] };
const F7 = { depth: 1, frameId: 7, parentFrameId: 0, ancestors: [0] };
const TOP = { depth: 0, frameId: 0, parentFrameId: -1, ancestors: [] };

function noas(frame: object, t = T0): NormalizedEvent {
  return ev({
    host: "noas.synthetic-adfection.test",
    path: "/getAd",
    params: NOAS_PARAMS,
    t,
    ...frame,
  });
}
function script(frame: object, t = T0 + 500): NormalizedEvent {
  return ev({
    host: "cdn.synthetic-benign.test",
    eventType: "response_inspected",
    inspection: { markers: SCRIPT },
    t,
    ...frame,
  });
}
function c2(frame: object, t = T0 + 2000): NormalizedEvent {
  return ev({ host: "c2.synthetic-adfection.test", t, ...frame });
}
const find = (h: Harness, id: string) => h.all.find((d) => d.ruleId === id);

describe("frame-lineage relation", () => {
  it("same frame, ancestor membership, shared ad-frame ancestor", () => {
    expect(lineageRelation(ev({ host: "a.test", ...F5 }), ev({ host: "b.test", ...F5 }))).toBe(
      "related",
    );
    expect(lineageRelation(ev({ host: "a.test", ...F5 }), ev({ host: "b.test", ...F9 }))).toBe(
      "related",
    );
    const g1 = { depth: 3, frameId: 11, parentFrameId: 9, ancestors: [9, 5, 0] };
    const g2 = { depth: 2, frameId: 12, parentFrameId: 5, ancestors: [5, 0] };
    expect(lineageRelation(ev({ host: "a.test", ...g1 }), ev({ host: "b.test", ...g2 }))).toBe(
      "related",
    );
  });
  it("siblings under the top document and the top document itself are not lineage", () => {
    expect(lineageRelation(ev({ host: "a.test", ...F5 }), ev({ host: "b.test", ...F7 }))).toBe(
      "unrelated",
    );
    expect(lineageRelation(ev({ host: "a.test", ...F5 }), ev({ host: "b.test", ...TOP }))).toBe(
      "unrelated",
    );
  });
  it("a sub_frame load issued by a document is related to that document's events", () => {
    const load = ev({
      host: "x.test",
      type: "sub_frame",
      depth: 1,
      frameId: 7,
      parentFrameId: 0,
      ancestors: [0],
    });
    expect(lineageRelation(ev({ host: "a.test", ...TOP }), load)).toBe("related");
  });
  it("different tabs or missing ancestry are unknown", () => {
    expect(
      lineageRelation(ev({ host: "a.test", ...F5, tab: 1 }), ev({ host: "b.test", ...F5, tab: 2 })),
    ).toBe("unknown");
    expect(
      lineageRelation(
        ev({ host: "a.test", ...F5, ancestors: null }),
        ev({ host: "b.test", ...F7, ancestors: null }),
      ),
    ).toBe("unknown");
  });
});

describe("chain rules: lineage first, tab-level downgraded", () => {
  it("full chain in one ad frame is high priority with observed lineage evidence", () => {
    const h = new Harness();
    h.ingestAll([noas(F5), script(F5), c2(F5)]);
    const d = find(h, "correlation.adfection_chain")!;
    expect(d.severity).toBe("high_priority");
    expect(
      d.evidence.some((e) => e.kind === "observed" && /same frame lineage/.test(e.observed)),
    ).toBe(true);
  });

  it("chain across nested frames (ad frame -> child frame) is still lineage", () => {
    const h = new Harness();
    h.ingestAll([noas(F5), script(F9), c2(F9)]);
    expect(find(h, "correlation.adfection_chain")!.severity).toBe("high_priority");
  });

  it("step 3 in a sibling frame: one level lower with an inferred tab-only evidence item", () => {
    const h = new Harness();
    h.ingestAll([noas(F5), script(F5), c2(F7)]);
    const d = find(h, "correlation.adfection_chain")!;
    expect(d.severity).toBe("elevated");
    expect(
      d.evidence.some(
        (e) =>
          e.kind === "inferred" && /same tab but not in the same frame lineage/.test(e.observed),
      ),
    ).toBe(true);
  });

  it("step 3 from the top document (e.g. reading about the research) is downgraded", () => {
    const h = new Harness();
    h.ingestAll([noas(F5), script(F5), c2(TOP)]);
    expect(find(h, "correlation.adfection_chain")!.severity).toBe("elevated");
  });

  it("first-party start in a sibling frame drops to suspicious", () => {
    const h = new Harness();
    h.ingestAll([
      ev({ host: "news.synthetic-publisher.test", path: "/getAd", params: NOAS_PARAMS, ...F5 }),
      script(F5),
      c2(F7),
    ]);
    expect(find(h, "correlation.adfection_chain")!.severity).toBe("suspicious");
  });

  it("without frame ancestry (Chromium-like) falls back to tab level, downgraded, with missing visibility", () => {
    const h = new Harness();
    const noA = { ...F5, ancestors: null };
    h.ingestAll([noas(noA), script({ ...F7, ancestors: null }), c2({ ...F7, ancestors: null })]);
    const d = find(h, "correlation.adfection_chain")!;
    expect(d.severity).toBe("elevated");
    expect(d.missingVisibility.join(" ")).toMatch(
      /frame ancestry for this request was not available/,
    );
    expect(
      d.evidence.some(
        (e) => e.kind === "inferred" && /Frame ancestry was not available/.test(e.observed),
      ),
    ).toBe(true);
  });

  it("a later lineage chain escalates a tab-level detection in place", () => {
    const h = new Harness();
    h.ingestAll([noas(F5), script(F5), c2(F7)]);
    const r = h.ingest(c2(F5, T0 + 3000));
    expect(
      r.updated.some(
        (d) => d.ruleId === "correlation.adfection_chain" && d.severity === "high_priority",
      ),
    ).toBe(true);
  });

  it("suspicious script then malicious contact in a sibling frame is elevated, not high priority", () => {
    const h = new Harness();
    h.ingestAll([script(F5), c2(F7)]);
    expect(find(h, "correlation.suspicious_js_then_malicious_contact")!.severity).toBe("elevated");
    const h2 = new Harness();
    h2.ingestAll([script(F5), c2(F5)]);
    expect(find(h2, "correlation.suspicious_js_then_malicious_contact")!.severity).toBe(
      "high_priority",
    );
  });

  it("an unrelated NOAS request in a sibling frame does not suppress the script-only rule", () => {
    const h = new Harness();
    h.ingestAll([noas(F7), script(F5), c2(F5)]);
    expect(find(h, "correlation.suspicious_js_then_malicious_contact")!.severity).toBe(
      "high_priority",
    );
    expect(find(h, "correlation.adfection_chain")!.severity).toBe("elevated");
  });

  it("NOAS then loader frame: lineage elevated, unrelated frame suspicious", () => {
    const loader = (frame: object) =>
      ev({
        host: "d111.synthetic-cdn.test",
        path: "/iframe",
        params: ["impid"],
        type: "sub_frame",
        t: T0 + 1500,
        ...frame,
      });
    const h = new Harness();
    h.ingestAll([noas(F5), loader({ depth: 2, frameId: 9, parentFrameId: 5, ancestors: [5, 0] })]);
    expect(find(h, "correlation.noas_then_hidden_frame")!.severity).toBe("elevated");
    const h2 = new Harness();
    h2.ingestAll([noas(F5), loader({ depth: 2, frameId: 9, parentFrameId: 7, ancestors: [7, 0] })]);
    expect(find(h2, "correlation.noas_then_hidden_frame")!.severity).toBe("suspicious");
  });

  it("fingerprinting rule prefers a lineage anchor", () => {
    const h = new Harness();
    h.ingestAll([
      ev({ host: "sync.synthetic-tracking.test", type: "image", ...F7 }),
      noas(F5, T0 + 100),
      ev({ host: "fp.synthetic-benign.test", tp: ["fingerprinting"], t: T0 + 1000, ...F5 }),
    ]);
    const d = find(h, "profiling.fingerprinting_classified_in_ad_context")!;
    expect(d.subjectHostnames).toContain("noas.synthetic-adfection.test");
    expect(d.confidenceRationale).toMatch(/same frame lineage/);
    const h2 = new Harness();
    h2.ingestAll([
      noas(F7),
      ev({ host: "fp.synthetic-benign.test", tp: ["fingerprinting"], t: T0 + 1000, ...F5 }),
    ]);
    expect(
      find(h2, "profiling.fingerprinting_classified_in_ad_context")!.confidenceRationale,
    ).toMatch(/tab and time only/);
  });
});

describe("validity-aware indicator confidence", () => {
  const set = (extra: object[]): IndicatorSet => ({
    ...SYNTHETIC_SET,
    meta: { ...SYNTHETIC_SET.meta, id: "validity-test" },
    indicators: SYNTHETIC_SET.indicators.map((r) => {
      const over = extra.find((x) => (x as { id: string }).id === r.id);
      return over ? { ...r, ...over } : r;
    }),
  });
  const harness = (extra: object[]) => new Harness({ matcher: new IndicatorMatcher([set(extra)]) });

  it("expired malicious indicator: confidence one step lower, limitation added, severity unchanged", () => {
    const h = harness([{ id: "syn-0001", validTo: "2026-06-30" }]);
    const d = h
      .ingest(c2(TOP, T0))
      .detections.find((x) => x.ruleId === "known_infra.malicious_contact")!;
    expect(d.severity).toBe("elevated");
    expect(d.confidence).toBe("medium");
    expect(d.limitations.join(" ")).toMatch(
      /past its documented validity window; the host may have been reassigned/,
    );
    expect(d.evidence[0]!.observed).toMatch(/past its documented validity window/);
  });

  it("expired NOAS indicator never raises surveillance severity above suspicious", () => {
    const h = harness([{ id: "syn-0003", validTo: "2026-06-30" }]);
    const d = h
      .ingest(ev({ host: "noas.synthetic-adfection.test", type: "script" }))
      .detections.find((x) => x.ruleId === "known_infra.surveillance_contact")!;
    expect(d.severity).toBe("suspicious");
    expect(d.confidence).toBe("medium");
  });

  it("current and not-yet-valid windows keep the indicator's confidence", () => {
    const h = harness([{ id: "syn-0001", validFrom: "2026-01-01", validTo: "2027-12-31" }]);
    expect(h.ingest(c2(TOP, T0)).detections[0]!.confidence).toBe("high");
    const h2 = harness([{ id: "syn-0003", validFrom: "2027-01-01" }]);
    const d = h2
      .ingest(ev({ host: "noas.synthetic-adfection.test" }))
      .detections.find((x) => x.ruleId === "known_infra.surveillance_contact")!;
    expect(d.severity).toBe("elevated");
    expect(d.confidence).toBe("high");
  });

  it("validity follows the evaluation clock across the validTo day boundary (no stale cache)", () => {
    const h = harness([{ id: "syn-0001", validTo: "2026-11-02" }]);
    expect(h.ingest(c2(TOP, T0)).detections[0]!.confidence).toBe("high");
    const next = h.ingest(ev({ host: "c2.synthetic-adfection.test", t: T0 + 24 * 3600_000 }));
    expect(next.detections[0]!.confidence).toBe("medium");
  });
});

describe("page-signal rules", () => {
  it("are not evaluable without the page sensor, and list page_signals as missing", () => {
    for (const h of [
      new Harness(),
      // capability present but the setting is off
      {
        engine: new DetectionEngine({
          matcher: new IndicatorMatcher([SYNTHETIC_SET]),
          capabilities: { browser: "firefox", capabilities: PAGE_CAPS, notes: [] },
          settings: settings({ pageSensorEnabled: false }),
          now: () => T0,
        }),
      },
    ]) {
      const page = h.engine.listRules().filter((s) => s.definition.id.startsWith("page."));
      expect(page.map((s) => s.definition.id).sort()).toEqual([
        "page.hidden_iframe_after_load",
        "page.late_third_party_script",
        "page.sdk_ready_message",
      ]);
      for (const s of page) {
        expect(s.evaluable).toBe(false);
        expect(s.missingCapabilities).toEqual(["page_signals"]);
      }
    }
    const h = new Harness();
    expect(h.ingest(sig("postmessage_sdk_ready", F5)).detections).toEqual([]);
    expect(
      new Harness({ pageSensor: true }).engine
        .listRules()
        .filter((s) => s.definition.id.startsWith("page."))
        .every((s) => s.evaluable),
    ).toBe(true);
  });

  it("rulesetVersion changes with the page rules", () => {
    expect(new Harness().engine.rulesetVersion).toMatch(/^22r-[0-9a-f]{8}$/);
  });

  it("page.sdk_ready_message: sub-frame elevated/high, top suspicious, wildcard-like no detection", () => {
    const h = new Harness({ pageSensor: true });
    const d = h.ingest(sig("postmessage_sdk_ready", F5)).detections;
    expect(ids(d)).toEqual(["page.sdk_ready_message"]);
    expect([d[0]!.severity, d[0]!.confidence]).toEqual(["elevated", "high"]);
    expect(d[0]!.summary).toMatch(/analytics_sdk_ready/);
    const top = h.ingest(
      sig("postmessage_sdk_ready", { ...TOP, host: "other.synthetic-publisher.test" }),
    ).detections;
    expect(top[0]!.severity).toBe("suspicious");
    // Generic typed messages: event only, never a detection (benign run 2026-11-02).
    const w = h.ingest(sig("postmessage_wildcard_like", { ...F5, crossOrigin: true }));
    expect(w.detections).toEqual([]);
    expect(h.engine.window.recent().some((e) => e.eventId === w.event.eventId)).toBe(true);
  });

  it("page.hidden_iframe_after_load: cross-origin suspicious, after lineage NOAS elevated, same-origin nothing", () => {
    const h = new Harness({ pageSensor: true });
    const alone = h.ingest(
      sig("hidden_iframe_inserted", { ...F5, crossOrigin: true, target: "x.synthetic-cdn.test" }),
    ).detections;
    expect(alone.map((d) => `${d.ruleId}:${d.severity}:${d.confidence}`)).toEqual([
      "page.hidden_iframe_after_load:suspicious:low",
    ]);
    expect(
      h.ingest(sig("hidden_iframe_inserted", { ...F5, crossOrigin: false })).detections,
    ).toEqual([]);
    expect(h.ingest(sig("hidden_iframe_inserted", F5)).detections).toEqual([]);

    const h2 = new Harness({ pageSensor: true });
    h2.ingest(noas(F5));
    const d = h2
      .ingest(
        sig("hidden_iframe_inserted", {
          ...F5,
          crossOrigin: true,
          target: "d111.synthetic-cdn.test",
          t: T0 + 800,
          msSinceLoad: 700,
        }),
      )
      .detections.find((x) => x.ruleId === "page.hidden_iframe_after_load")!;
    expect(d.severity).toBe("elevated");
    expect(d.eventIds.length).toBe(2);

    // NOAS in a sibling frame is not the same lineage
    const h3 = new Harness({ pageSensor: true });
    h3.ingest(noas(F7));
    const d3 = h3.ingest(
      sig("hidden_iframe_inserted", { ...F5, crossOrigin: true, t: T0 + 800 }),
    ).detections;
    expect(d3.find((x) => x.ruleId === "page.hidden_iframe_after_load")!.severity).toBe(
      "suspicious",
    );
  });

  it("page.late_third_party_script: no detection alone, suspicious after lineage NOAS", () => {
    const h = new Harness({ pageSensor: true });
    const alone = h.ingest(
      sig("script_inserted", { ...F5, crossOrigin: true, target: "cdn.synthetic-benign.test" }),
    ).detections;
    expect(alone).toEqual([]);
    expect(h.ingest(sig("script_inserted", { ...F5, crossOrigin: false })).detections).toEqual([]);
    const h2 = new Harness({ pageSensor: true });
    h2.ingest(noas(F5));
    const d = h2.ingest(
      sig("script_inserted", { ...F5, crossOrigin: true, t: T0 + 600 }),
    ).detections;
    expect(d[0]!.severity).toBe("suspicious");
  });

  it("beacon_image_inserted alone produces no detection", () => {
    const h = new Harness({ pageSensor: true });
    expect(h.ingest(sig("beacon_image_inserted", { ...F5, crossOrigin: true })).detections).toEqual(
      [],
    );
  });

  it("page signals never count as network contact with an indicator host", () => {
    const h = new Harness({ pageSensor: true });
    const s = sig("script_inserted", { ...F5, host: "c2.synthetic-adfection.test" });
    expect(h.ingest(s).detections.filter((d) => d.category === "known_infrastructure")).toEqual([]);
  });

  it("adfection chain accepts an observed page-signal step 2 in the lineage", () => {
    const h = new Harness({ pageSensor: true });
    h.ingestAll([
      noas(F5),
      sig("hidden_iframe_inserted", {
        ...F5,
        crossOrigin: true,
        target: "d111.synthetic-cdn.test",
        t: T0 + 700,
      }),
      c2(F9),
    ]);
    const d = find(h, "correlation.adfection_chain")!;
    expect(d.severity).toBe("high_priority");
    expect(d.evidence.find((e) => e.observed.startsWith("Step 2"))!.observed).toMatch(
      /page sensor observed a hidden cross-origin iframe/,
    );
    expect(d.evidence.find((e) => e.observed.startsWith("Step 2"))!.kind).toBe("observed");
  });

  it("page-signal step 2 does not count from a sibling frame, nor for the script-only rule", () => {
    const h = new Harness({ pageSensor: true });
    h.ingestAll([
      noas(F5),
      sig("hidden_iframe_inserted", { ...F7, crossOrigin: true, t: T0 + 700 }),
      c2(F5),
    ]);
    expect(find(h, "correlation.adfection_chain")).toBeUndefined();
    const h2 = new Harness({ pageSensor: true });
    h2.ingestAll([sig("script_inserted", { ...F5, crossOrigin: true }), c2(F5)]);
    expect(find(h2, "correlation.suspicious_js_then_malicious_contact")).toBeUndefined();
  });

  it("with response inspection disabled the chain stays evaluable via the page sensor", () => {
    const engine = new DetectionEngine({
      matcher: new IndicatorMatcher([SYNTHETIC_SET]),
      capabilities: { browser: "firefox", capabilities: PAGE_CAPS, notes: [] },
      settings: settings({ responseInspectionEnabled: false, pageSensorEnabled: true }),
      now: () => T0 + 5000,
    });
    const chain = engine
      .listRules()
      .find((s) => s.definition.id === "correlation.adfection_chain")!;
    expect(chain.evaluable).toBe(true);
    engine.ingest(noas(F5));
    engine.ingest(sig("script_inserted", { ...F5, crossOrigin: true, t: T0 + 500 }));
    const r = engine.ingest(c2(F5));
    expect(r.detections.map((d) => d.ruleId)).toContain("correlation.adfection_chain");
  });
});

describe("review follow-up: late page signals and step-2 strength", () => {
  const chains = (h: Harness) => h.all.filter((d) => d.ruleId === "correlation.adfection_chain");
  const hidden = (t: number, frame: object = F5) =>
    sig("hidden_iframe_inserted", {
      ...frame,
      crossOrigin: true,
      target: "d111.synthetic-cdn.test",
      t,
    });

  it("a page-signal step 2 arriving after step 3 (earlier timestamp) completes the chain exactly once", () => {
    const h = new Harness({ pageSensor: true });
    h.ingest(noas(F5, T0));
    h.ingest(c2(F5, T0 + 2000));
    expect(chains(h)).toEqual([]);
    const r = h.ingest(hidden(T0 + 700));
    expect(r.detections.filter((d) => d.ruleId === "correlation.adfection_chain")).toHaveLength(1);
    expect(chains(h)).toHaveLength(1);
    expect(chains(h)[0]!.severity).toBe("high_priority");
    expect(chains(h)[0]!.eventIds).toHaveLength(3);
  });

  it("the late-signal form and a later step-3 form share a dedup key", () => {
    const h = new Harness({ pageSensor: true });
    h.ingest(noas(F5, T0));
    h.ingest(c2(F5, T0 + 2000));
    h.ingest(hidden(T0 + 700));
    const again = h.ingest(c2(F5, T0 + 4000));
    expect(again.detections.filter((d) => d.ruleId === "correlation.adfection_chain")).toEqual([]);
    expect(again.updated.some((d) => d.ruleId === "correlation.adfection_chain")).toBe(true);
    expect(chains(h)).toHaveLength(1);
  });

  it("a late signal does not complete a chain across sibling frames or outside the window", () => {
    const h = new Harness({ pageSensor: true });
    h.ingest(noas(F7, T0));
    h.ingest(c2(F5, T0 + 2000));
    h.ingest(hidden(T0 + 700));
    expect(chains(h)).toEqual([]);
    const h2 = new Harness({ pageSensor: true, windowMs: 60_000 });
    h2.ingest(noas(F5, T0));
    h2.ingest(c2(F5, T0 + 100_000));
    h2.ingest(hidden(T0 + 50_000));
    expect(chains(h2)).toEqual([]);
  });

  it("a plain cross-origin script insertion as the only step 2 lowers the chain one level", () => {
    const h = new Harness({ pageSensor: true });
    h.ingestAll([
      noas(F5),
      sig("script_inserted", {
        ...F5,
        crossOrigin: true,
        target: "cdn.synthetic-benign.test",
        t: T0 + 500,
      }),
      c2(F5),
    ]);
    const d = chains(h)[0]!;
    expect(d.severity).toBe("elevated");
    expect(
      d.evidence.some(
        (e) => e.kind === "inferred" && /only a cross-origin script insertion/.test(e.observed),
      ),
    ).toBe(true);
    // late arrival of the same weak signal is lowered the same way
    const h2 = new Harness({ pageSensor: true });
    h2.ingest(noas(F5, T0));
    h2.ingest(c2(F5, T0 + 2000));
    h2.ingest(sig("script_inserted", { ...F5, crossOrigin: true, t: T0 + 500 }));
    expect(chains(h2)[0]!.severity).toBe("elevated");
  });

  it("a script insertion targeting documented infrastructure is a full step 2", () => {
    const h = new Harness({ pageSensor: true });
    h.ingestAll([
      noas(F5),
      sig("script_inserted", {
        ...F5,
        crossOrigin: true,
        target: "cdn.synthetic-dsp.test",
        t: T0 + 500,
      }),
      c2(F5),
    ]);
    expect(chains(h)[0]!.severity).toBe("high_priority");
  });

  it("a strong step 2 is preferred over a later weak one", () => {
    const h = new Harness({ pageSensor: true });
    h.ingestAll([
      noas(F5),
      hidden(T0 + 300),
      sig("script_inserted", { ...F5, crossOrigin: true, t: T0 + 600 }),
      c2(F5),
    ]);
    expect(chains(h)[0]!.severity).toBe("high_priority");
  });

  it("page.sdk_ready_message: same-origin message is informational", () => {
    const h = new Harness({ pageSensor: true });
    const same = h.ingest(sig("postmessage_sdk_ready", { ...F5, crossOrigin: false })).detections;
    expect([same[0]!.severity, same[0]!.confidence]).toEqual(["informational", "low"]);
    const cross = h.ingest(sig("postmessage_sdk_ready", { ...F5, crossOrigin: true })).detections;
    expect(cross[0]!.severity).toBe("elevated");
  });
});

describe("review follow-up 2: page-signal step 2 needs a documented NOAS host for high priority", () => {
  const staged = (s1Host: string) => {
    const h = new Harness({ pageSensor: true });
    h.ingestAll([
      ev({ host: s1Host, path: "/getAd", params: NOAS_PARAMS, ...F5 }),
      sig("hidden_iframe_inserted", {
        ...F5,
        crossOrigin: true,
        target: "d111.synthetic-cdn.test",
        t: T0 + 500,
      }),
      ev({ host: "c2.synthetic-adfection.test", type: "image", t: T0 + 1000, ...F5 }),
    ]);
    return h.all.find((d) => d.ruleId === "correlation.adfection_chain")!;
  };

  it("a hostile frame staging /getAd + 1x1 frame + <img> to malicious infrastructure is capped at elevated", () => {
    const d = staged("ads.synthetic-hostile.test");
    expect(d.severity).toBe("elevated");
    expect(
      d.evidence.some((e) => e.kind === "inferred" && /capped at elevated/.test(e.observed)),
    ).toBe(true);
  });

  it("with a documented NOAS indicator host as step 1 it stays high priority", () => {
    expect(staged("noas.synthetic-adfection.test").severity).toBe("high_priority");
  });
});
