import { describe, expect, it } from "vitest";
import type { Detection, NormalizedEvent } from "@adtripwire/shared";
import { ALL_RULES } from "./index.js";
import {
  Harness,
  PENDING_NB_RULE_IDS,
  T0,
  assertConservativeNb,
  assertNbMirrorsEnglish,
  ev,
  nbRequiredRuleIds,
  sig,
  ruleDefinitionNbTexts,
} from "../__test__/fixtures.js";
import { buildDetection, missingVisibilityBoth } from "./common.js";

const NOAS_PARAMS = ["idfa", "sourceId", "dom", "page", "country", "os"];
const F5 = { depth: 1, frameId: 5, parentFrameId: 0, ancestors: [0] };
const F7 = { depth: 1, frameId: 7, parentFrameId: 0, ancestors: [0] };

const noas = (frame: object, t = T0): NormalizedEvent =>
  ev({ host: "noas.synthetic-adfection.test", path: "/getAd", params: NOAS_PARAMS, t, ...frame });
const script = (frame: object, t = T0 + 500): NormalizedEvent =>
  ev({
    host: "cdn.synthetic-benign.test",
    eventType: "response_inspected",
    inspection: { markers: ["js.iframe_create", "js.iframe_1x1", "js.script_inject"] },
    t,
    ...frame,
  });
const c2 = (frame: object, t = T0 + 2000): NormalizedEvent =>
  ev({ host: "c2.synthetic-adfection.test", t, ...frame });

/** Runs one scenario and returns every detection (created and updated) it produced. */
function run(events: NormalizedEvent[], h = new Harness()): Detection[] {
  const out: Detection[] = [];
  for (const e of events) {
    const r = h.ingest(e);
    out.push(...r.detections, ...r.updated);
  }
  return out;
}

/** One response_inspected scenario per JavaScript rule (and the branch that changes the wording). */
function jsScenarios(): Detection[][] {
  const inspected = (host: string, markers: string[]): Detection[] =>
    run([ev({ host, eventType: "response_inspected", inspection: { markers } })]);
  return [
    inspected("a1.synthetic-benign.test", ["js.adfection_sdk_auth", "js.adfection_sdk_ready"]),
    inspected("a2.synthetic-benign.test", ["js.error_stack_trap"]),
    inspected("a3.synthetic-benign.test", ["js.error_stack_trap", "js.obfuscation_bang_bracket"]),
    inspected("a4.synthetic-benign.test", [
      "js.cookie_read",
      "js.cookie_tilde_join",
      "js.colocated_cookie_exfil",
    ]),
    inspected("a5.synthetic-benign.test", [
      "js.cookie_read",
      "js.image_beacon",
      "js.colocated_cookie_exfil",
    ]),
    inspected("a6.synthetic-benign.test", ["js.doh_cloudflare", "js.raw_ip_fetch"]),
    inspected("a7.synthetic-benign.test", [
      "js.new_function",
      "js.timer_polling",
      "js.aes_cbc",
      "js.colocated_dynamic_transport",
    ]),
    inspected("a8.synthetic-benign.test", ["js.iframe_create", "js.iframe_1x1"]),
    inspected("a9.synthetic-benign.test", [
      "js.iframe_create",
      "js.iframe_1x1",
      "js.script_inject",
    ]),
  ];
}

/** Page-sensor scenarios (opt-in sensor on), including the with and without NOAS branches. */
function pageScenarios(): Detection[][] {
  const page = (events: NormalizedEvent[]): Detection[] =>
    run(events, new Harness({ pageSensor: true }));
  return [
    page([sig("postmessage_sdk_ready", F5)]),
    page([sig("postmessage_sdk_ready", { ...F5, crossOrigin: false })]),
    page([
      sig("postmessage_sdk_ready", {
        depth: 0,
        frameId: 0,
        parentFrameId: -1,
        ancestors: [],
        host: "other.synthetic-publisher.test",
        crossOrigin: true,
      }),
    ]),
    page([
      sig("hidden_iframe_inserted", { ...F5, crossOrigin: true, target: "x.synthetic-cdn.test" }),
    ]),
    page([
      noas(F5),
      sig("hidden_iframe_inserted", {
        ...F5,
        crossOrigin: true,
        target: "x.synthetic-cdn.test",
        t: T0 + 600,
      }),
    ]),
    page([
      noas(F5),
      sig("script_inserted", {
        ...F5,
        crossOrigin: true,
        target: "cdn.synthetic-benign.test",
        t: T0 + 600,
      }),
    ]),
  ];
}

/** Scenarios that between them make every translated rule fire (several on more than one branch). */
function scenarios(): Detection[][] {
  const chainEvents = (rid: string, hosts: string[], t: number) => {
    const base = { rid, tab: 7, tp: ["tracking_ad" as const] };
    return [
      ev({ ...base, host: hosts[0]!, type: "image", t }),
      ...hosts.slice(0, -1).map((h, i) =>
        ev({
          ...base,
          host: h,
          eventType: "request_redirected",
          redirectHost: hosts[i + 1]!,
          t: t + i + 1,
        }),
      ),
    ];
  };
  const SYNC = [
    "a.synthetic-ads1.test",
    "b.synthetic-ads2.test",
    "c.synthetic-ads3.test",
    "d.synthetic-ads4.test",
  ];
  const loader = ev({
    host: "d111.synthetic-cdn.test",
    path: "/iframe",
    params: ["impid"],
    type: "sub_frame",
    t: T0 + 1500,
    depth: 2,
    frameId: 9,
    parentFrameId: 5,
    ancestors: [5, 0],
  });
  const noasReq = ev({ host: "ads.synthetic-benign.test", path: "/getAd", params: ["idfa"] });
  const completed = (size: number): NormalizedEvent => ({
    ...noasReq,
    eventId: `c${size}`,
    eventType: "request_completed",
    requestStatus: "completed",
    responseSizeIfObservable: size,
    timestamp: T0 + 10,
  });
  const days = (n: number): NormalizedEvent[] =>
    Array.from({ length: n }, (_, i) =>
      ev({ host: "sync.synthetic-tracking.test", type: "image", t: T0 + i * 86_400_000 }),
    );
  const out: Detection[][] = [
    run([ev({ host: "c2.synthetic-adfection.test" })]),
    run([ev({ host: "sync.synthetic-tracking.test", type: "image" })]),
    run([ev({ host: "noas.synthetic-adfection.test", path: "/other" })]),
    run([ev({ host: "synthetic-dsp.test" })]),
    run([ev({ host: "corp.synthetic-vendor.test", type: "main_frame", thirdParty: false })]),
    run([ev({ host: "c2.synthetic-adfection.test", type: "sub_frame", depth: 1 })]),
    run([noasReq]),
    run([
      ev({
        host: "shop.synthetic-benign.test",
        path: "/getAd",
        params: ["idfa"],
        thirdParty: false,
      }),
    ]),
    run([noasReq, completed(0)]),
    run([noasReq, completed(900)]),
    run([
      noasReq,
      {
        ...completed(900),
        eventId: "insp",
        eventType: "response_inspected",
        responseInspection: {
          observedBytes: 900,
          truncated: false,
          textDecodable: true,
          markers: ["js.iframe_create", "js.iframe_1x1", "js.script_inject"],
          contentType: "application/javascript",
        },
      },
    ]),
    run([
      ...chainEvents("s1", SYNC, T0),
      ...chainEvents(
        "s2",
        [
          "a.synthetic-ads1.test",
          "sync.synthetic-tracking.test",
          "c.synthetic-ads3.test",
          "d.synthetic-ads4.test",
        ],
        T0 + 1000,
      ),
    ]),
    run([noas(F5), script(F5), c2(F5)]),
    run([noas(F5), script(F5), c2(F7)]),
    run([script(F5), c2(F5)]),
    run([noas(F5), loader]),
    run(days(3)),
    // observation limitation path
    run([ev({ host: "c2.synthetic-adfection.test", limitations: ["from_cache"] })]),
    ...jsScenarios(),
    run([ev({ host: "t.synthetic-benign.test", params: ["idfa", "ipv4", "lat", "w"] })]),
    run([ev({ host: "u.synthetic-benign.test", params: ["cookie"], tp: ["tracking_ad"] })]),
    run([noasReq, ev({ host: "fp.synthetic-benign.test", tp: ["fingerprinting"], t: T0 + 1000 })]),
    run([
      noas(F5),
      ev({ host: "fp.synthetic-benign.test", tp: ["fingerprinting"], t: T0 + 1000, ...F5 }),
    ]),
    ...pageScenarios(),
  ];
  return out;
}

describe("phase 11: Norwegian detection text", () => {
  it("pending list plus translated list covers every shipped rule exactly once", () => {
    const all = ALL_RULES.map((r) => r.definition.id).sort();
    const required = nbRequiredRuleIds();
    expect([...required, ...PENDING_NB_RULE_IDS].sort()).toEqual(all);
    for (const id of required) expect(PENDING_NB_RULE_IDS).not.toContain(id);
  });

  it("every translated rule has complete RuleDefinition nb text that mirrors the English", () => {
    for (const r of ALL_RULES) {
      const d = r.definition;
      if (PENDING_NB_RULE_IDS.includes(d.id)) continue;
      const nb = d.nb;
      expect(nb, d.id).toBeDefined();
      expect(nb!.limitations.length, d.id).toBe(d.limitations.length);
      expect(nb!.falsePositiveConsiderations.length, d.id).toBe(
        d.falsePositiveConsiderations.length,
      );
      for (const t of ruleDefinitionNbTexts(nb!)) {
        expect(t.trim().length, d.id).toBeGreaterThan(0);
        assertConservativeNb(`${d.id} definition.nb`, t);
      }
      expect(nb!.name).not.toBe(d.name);
    }
  });

  it("every translated rule's positive detections carry nb that mirrors every English field", () => {
    const seen = new Set<string>();
    for (const ds of scenarios()) {
      for (const d of ds) {
        seen.add(d.ruleId);
        if (!nbRequiredRuleIds().includes(d.ruleId)) continue;
        expect(d.nb, d.ruleId).toBeDefined();
        assertNbMirrorsEnglish(d);
        expect(d.nb!.missingVisibility.length).toBe(d.missingVisibility.length);
      }
    }
    for (const id of nbRequiredRuleIds()) expect(seen.has(id), `${id} did not fire`).toBe(true);
  });

  it("interpolated hostnames, indicator ids and counts appear in both languages", () => {
    const [chainDetections] = scenarios().filter((ds) =>
      ds.some(
        (d) => d.ruleId === "ad_delivery.redirect_chain" && /sync\.synthetic/.test(d.summary),
      ),
    );
    const d = chainDetections!.filter((x) => x.ruleId === "ad_delivery.redirect_chain").at(-1)!;
    expect(d.summary).toContain("sync.synthetic-tracking.test");
    expect(d.nb!.summary).toContain("sync.synthetic-tracking.test");

    const [malicious] = run([ev({ host: "c2.synthetic-adfection.test" })]);
    expect(malicious!.nb!.confidenceRationale).toContain("syn-0001");
    expect(malicious!.confidenceRationale).toContain("syn-0001");

    const exposure = scenarios()
      .flat()
      .find((x) => x.ruleId === "exposure.repeated_surveillance_contact")!;
    expect(exposure.summary).toContain("3 distinct days");
    expect(exposure.nb!.summary).toContain("3 ulike dager");
  });

  it("buildDetection omits nb when none is given or when an array does not mirror the English", () => {
    const h = new Harness();
    const e = ev({ host: "c2.synthetic-adfection.test" });
    const ctx = {
      capabilities: [],
      now: T0,
    } as unknown as Parameters<typeof buildDetection>[1];
    const args = {
      subject: "s",
      confidenceRationale: "c",
      summary: "s",
      significance: "g",
      evidence: [],
      events: [e],
      subjectHostnames: [],
      alternativeExplanations: ["a", "b"],
    };
    const def = ALL_RULES[0]!.definition;
    expect("nb" in buildDetection(def, ctx, args)).toBe(false);
    const nb = {
      confidenceRationale: "c",
      summary: "s",
      significance: "g",
      alternativeExplanations: ["a", "b"],
    };
    expect(buildDetection(def, ctx, { ...args, nb }).nb?.alternativeExplanations).toEqual([
      "a",
      "b",
    ]);
    const short = { ...nb, alternativeExplanations: ["a"] };
    expect("nb" in buildDetection(def, ctx, { ...args, nb: short })).toBe(false);
    expect(h.all).toEqual([]);
  });

  it("missingVisibility is built in lockstep in both languages", () => {
    const e = ev({ host: "a.test", limitations: ["from_cache", "response_size_unknown"] });
    const mv = missingVisibilityBoth([e], ["request_metadata"], ["frame_ancestry_unavailable"]);
    expect(mv.nb).toHaveLength(mv.en.length);
    expect(new Set(mv.nb).size).toBe(mv.nb.length);
  });
});

describe("phase 11: Norwegian verdict-word guard", () => {
  it("catches planted verdict words", () => {
    for (const bad of [
      "Enheten er infisert.",
      "Enheten din er kompromittert.",
      "Du har blitt spionert på.",
      "Enheten har overvåket deg.",
      "Enheten er trygg.",
      "Nettleseren er sikker.",
      "Enheten er ren.",
      "Dette er uten fare.",
      "Telefonen er hacket.",
      "Du er smittet.",
    ]) {
      expect(() => assertConservativeNb("planted", bad), bad).toThrow(/Forbidden Norwegian/);
    }
  });

  it("is applied to a detection's nb text through the harness guard", () => {
    const [d] = run([ev({ host: "c2.synthetic-adfection.test" })]);
    expect(() =>
      assertConservativeNb(
        "planted",
        [...d!.nb!.alternativeExplanations, "Enheten er infisert."].join(" "),
      ),
    ).toThrow();
  });

  it("does not flag ordinary words that contain the stems", () => {
    for (const ok of [
      "Kontakt en hjelpetjeneste for digital sikkerhet.",
      "Vi er usikre, og dette er usikker informasjon.",
      "Observert trafikk til dokumentert infrastruktur; dette kan tyde på eksponering og sier ikke noe om enheten.",
      "Sjekk rente- og trenddata, og frenning.",
      "Spionprogramvare er beskrevet i forskningen.",
    ]) {
      expect(() => assertConservativeNb("ok", ok), ok).not.toThrow();
    }
  });
});
