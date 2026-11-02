import { describe, expect, it } from "vitest";
import { loadBundledMatcher } from "@adtripwire/indicators";
import { ALL_RULES } from "./index.js";
import { isNoasPath, approxRegistrableDomain } from "./common.js";
import { jsGrade } from "./js-common.js";
import { Harness, T0, ev, ids } from "../__test__/fixtures.js";

describe("12. rule metadata completeness", () => {
  it("every rule has complete, unique metadata", () => {
    const seen = new Set<string>();
    for (const r of ALL_RULES) {
      const d = r.definition;
      expect(seen.has(d.id), d.id).toBe(false);
      seen.add(d.id);
      expect(d.version).toMatch(/^\d+\.\d+\.\d+$/);
      for (const k of [
        "id",
        "name",
        "description",
        "category",
        "severity",
        "confidence",
        "confidenceBasis",
      ] as const) {
        expect(typeof d[k] === "string" && d[k].length > 0, `${d.id}.${k}`).toBe(true);
      }
      for (const k of [
        "requiredEvidence",
        "requiredCapabilities",
        "references",
        "limitations",
        "falsePositiveConsiderations",
      ] as const) {
        expect(d[k].length, `${d.id}.${k}`).toBeGreaterThan(0);
      }
      expect(d.references.every((ref) => /^https:\/\//.test(ref.url) && ref.title.length > 0)).toBe(
        true,
      );
      expect(typeof r.evaluate).toBe("function");
    }
    expect(ALL_RULES.length).toBe(22);
  });
});

describe("helpers", () => {
  it("isNoasPath", () => {
    expect(isNoasPath("/getAd")).toBe(true);
    expect(isNoasPath("/getAd/")).toBe(true);
    expect(isNoasPath("/cplatform/getAd")).toBe(true);
    expect(isNoasPath("/GetAd")).toBe(false);
    expect(isNoasPath("/getAds")).toBe(false);
    expect(isNoasPath("/a/cplatform/getAd")).toBe(false);
  });
  it("approxRegistrableDomain", () => {
    expect(approxRegistrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(approxRegistrableDomain("x.y.synthetic-dsp.test")).toBe("synthetic-dsp.test");
    expect(approxRegistrableDomain("203.0.113.5")).toBe("203.0.113.5");
    // A host that is itself a public suffix stays whole instead of collapsing to "kawasaki.jp".
    expect(approxRegistrableDomain("a.kawasaki.jp")).toBe("a.kawasaki.jp");
    expect(approxRegistrableDomain("x.a.kawasaki.jp")).toBe("x.a.kawasaki.jp");
  });
  it("jsGrade", () => {
    expect(jsGrade([])).toBeNull();
    expect(jsGrade(["js.error_stack_trap"])).toBe("informational");
    expect(jsGrade(["js.cookie_read", "js.image_beacon", "js.colocated_cookie_exfil"])).toBe(
      "elevated",
    );
    // Not co-located: the combination no longer grades.
    expect(jsGrade(["js.cookie_read", "js.image_beacon"])).toBeNull();
  });
});

describe("individual rules", () => {
  it("surveillance tracking contact is suspicious with very-common-exposure text", () => {
    const h = new Harness();
    const { detections } = h.ingest(ev({ host: "sync.synthetic-tracking.test", type: "image" }));
    expect(ids(detections)).toEqual(["known_infra.surveillance_contact"]);
    expect(detections[0]!.severity).toBe("suspicious");
    expect(detections[0]!.summary).toMatch(/very common exposure/);
  });

  it("domain indicator matches subdomains boundary-safely", () => {
    const h = new Harness();
    expect(ids(h.ingestAll([ev({ host: "a.b.synthetic-dsp.test" })]))).toEqual([
      "known_infra.surveillance_contact",
    ]);
    expect(h.ingestAll([ev({ host: "notsynthetic-dsp.test" })])).toEqual([]);
  });

  it("contextual contact is informational/low", () => {
    const h = new Harness();
    const { detections } = h.ingest(
      ev({ host: "corp.synthetic-vendor.test", type: "main_frame", thirdParty: false }),
    );
    expect(ids(detections)).toEqual(["known_infra.contextual_contact"]);
    expect(detections[0]!.severity).toBe("informational");
    expect(detections[0]!.confidence).toBe("low");
  });

  it("first-party top-level NOAS pattern is only informational", () => {
    const h = new Harness();
    const { detections } = h.ingest(
      ev({
        host: "shop.synthetic-benign.test",
        path: "/getAd",
        params: ["idfa"],
        thirdParty: false,
      }),
    );
    expect(detections[0]!.severity).toBe("informational");
    expect(detections[0]!.confidence).toBe("low");
  });

  it("non-empty NOAS response without inspection is not elevated", () => {
    const h = new Harness();
    const start = ev({ host: "ads.synthetic-benign.test", path: "/getAd", params: ["idfa"] });
    h.ingest(start);
    const { detections } = h.ingest({
      ...start,
      eventId: "c1",
      eventType: "request_completed",
      requestStatus: "completed",
      responseSizeIfObservable: 900,
      timestamp: T0 + 10,
    });
    const d = detections.find((x) => x.ruleId === "ad_delivery.noas_selective_response")!;
    expect(d.severity).toBe("suspicious");
    expect(d.confidence).toBe("low");
  });

  it("no size observed: selective response does not fire", () => {
    const h = new Harness();
    const start = ev({ host: "ads.synthetic-benign.test", path: "/getAd", params: ["idfa"] });
    h.ingest(start);
    const { detections } = h.ingest({
      ...start,
      eventId: "c2",
      eventType: "request_completed",
      requestStatus: "completed",
      timestamp: T0 + 10,
    });
    expect(detections).toEqual([]);
  });

  it("redirect chain from ad context", () => {
    const h = new Harness();
    const base = { rid: "rr", tp: ["tracking_ad" as const] };
    const out = h.ingestAll([
      ev({ ...base, host: "a.synthetic-ads1.test", type: "image" }),
      ev({
        ...base,
        host: "a.synthetic-ads1.test",
        eventType: "request_redirected",
        redirectHost: "b.synthetic-ads2.test",
        t: T0 + 1,
      }),
      ev({
        ...base,
        host: "b.synthetic-ads2.test",
        eventType: "request_redirected",
        redirectHost: "c.synthetic-ads3.test",
        t: T0 + 2,
      }),
      ev({
        ...base,
        host: "c.synthetic-ads3.test",
        eventType: "request_redirected",
        redirectHost: "d.synthetic-ads4.test",
        t: T0 + 3,
      }),
    ]);
    const d = out.find((x) => x.ruleId === "ad_delivery.redirect_chain")!;
    expect(d.severity).toBe("informational");
    expect(d.confidence).toBe("low");
    expect(d.summary).toMatch(/counted as occurrences/);
  });

  /** One redirect chain: first request then `hosts.length - 1` redirects, all on one request id. */
  function chain(rid: string, tab: number, hosts: string[], t: number) {
    const base = { rid, tab, tp: ["tracking_ad" as const] };
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
  }
  const SYNC = [
    "a.synthetic-ads1.test",
    "b.synthetic-ads2.test",
    "c.synthetic-ads3.test",
    "d.synthetic-ads4.test",
  ];

  it("redirect chains in one tab are aggregated into one detection with an occurrence count", () => {
    const h = new Harness();
    const created: string[] = [];
    let last: { occurrenceCount: number } | undefined;
    for (const [i, rid] of ["s1", "s2", "s3"].entries()) {
      for (const e of chain(rid, 7, SYNC, T0 + i * 1000)) {
        const r = h.ingest(e);
        for (const d of r.detections)
          if (d.ruleId === "ad_delivery.redirect_chain") created.push(d.detectionId);
        for (const d of r.updated) if (d.ruleId === "ad_delivery.redirect_chain") last = d;
      }
    }
    expect(created).toHaveLength(1);
    expect(last?.occurrenceCount).toBe(3);
  });

  it("redirect chains in different tabs are reported separately", () => {
    const h = new Harness();
    const out = h.ingestAll([...chain("t1", 1, SYNC, T0), ...chain("t2", 2, SYNC, T0 + 10)]);
    expect(out.filter((d) => d.ruleId === "ad_delivery.redirect_chain")).toHaveLength(2);
  });

  it("a chain reaching documented infrastructure is suspicious and escalates the tab's detection", () => {
    const h = new Harness();
    let escalated: { severity: string; summary: string } | undefined;
    for (const e of chain("e1", 3, SYNC, T0)) h.ingest(e);
    for (const e of chain(
      "e2",
      3,
      [
        "a.synthetic-ads1.test",
        "b.synthetic-ads2.test",
        "sync.synthetic-tracking.test",
        "d.synthetic-ads4.test",
      ],
      T0 + 1000,
    )) {
      const r = h.ingest(e);
      for (const d of r.updated) if (d.ruleId === "ad_delivery.redirect_chain") escalated = d;
    }
    expect(escalated?.severity).toBe("suspicious");
    expect(escalated?.summary).toMatch(/sync\.synthetic-tracking\.test/);
  });

  it("a fresh tab whose first chain reaches documented infrastructure starts at suspicious", () => {
    const h = new Harness();
    const out = h.ingestAll(
      chain(
        "f1",
        9,
        [
          "a.synthetic-ads1.test",
          "sync.synthetic-tracking.test",
          "c.synthetic-ads3.test",
          "d.synthetic-ads4.test",
        ],
        T0,
      ),
    );
    expect(out.find((d) => d.ruleId === "ad_delivery.redirect_chain")?.severity).toBe("suspicious");
  });

  it("redirect chain without ad classification does not fire", () => {
    const h = new Harness();
    const out = h.ingestAll([
      ev({ rid: "rq", host: "a.synthetic-x1.test" }),
      ev({
        rid: "rq",
        host: "a.synthetic-x1.test",
        eventType: "request_redirected",
        redirectHost: "b.synthetic-x2.test",
        t: T0 + 1,
      }),
      ev({
        rid: "rq",
        host: "b.synthetic-x2.test",
        eventType: "request_redirected",
        redirectHost: "c.synthetic-x3.test",
        t: T0 + 2,
      }),
      ev({
        rid: "rq",
        host: "c.synthetic-x3.test",
        eventType: "request_redirected",
        redirectHost: "d.synthetic-x4.test",
        t: T0 + 3,
      }),
    ]);
    expect(out).toEqual([]);
  });

  it("nested frame to indicator is elevated", () => {
    const h = new Harness();
    const { detections } = h.ingest(
      ev({ host: "x.synthetic-dsp.test", type: "sub_frame", depth: 1 }),
    );
    expect(
      detections.find((d) => d.ruleId === "ad_delivery.nested_frame_to_indicator")!.severity,
    ).toBe("elevated");
  });

  it("identifier-rich request: informational, escalated with cookie material in ad context", () => {
    const h = new Harness();
    const a = h.ingest(
      ev({ host: "t.synthetic-benign.test", params: ["idfa", "ipv4", "lat", "w"] }),
    ).detections;
    expect(a.find((d) => d.ruleId === "profiling.identifier_rich_request")!.severity).toBe(
      "informational",
    );
    const b = h.ingest(
      ev({ host: "u.synthetic-benign.test", params: ["cookie"], tp: ["tracking_ad"] }),
    ).detections;
    expect(b.find((d) => d.ruleId === "profiling.identifier_rich_request")!.severity).toBe(
      "suspicious",
    );
    const c = h.ingest(
      ev({ host: "v.synthetic-benign.test", params: ["idfa", "ipv4", "lat"], thirdParty: false }),
    ).detections;
    expect(c).toEqual([]);
    // ad-tech bookkeeping names (q, qq, impid) do not count as identifiers
    expect(
      h.ingest(ev({ host: "w.synthetic-benign.test", params: ["q", "qq", "impid"] })).detections,
    ).toEqual([]);
  });

  it("fingerprinting classification near a NOAS request is suspicious; fingerprinting_content is ignored", () => {
    const h = new Harness();
    h.ingest(ev({ host: "ads.synthetic-benign.test", path: "/getAd", params: ["idfa"] }));
    const content = h.ingest(
      ev({ host: "fp0.synthetic-benign.test", tp: ["fingerprinting_content"], t: T0 + 500 }),
    ).detections;
    expect(content).toEqual([]);
    const { detections } = h.ingest(
      ev({ host: "fp.synthetic-benign.test", tp: ["fingerprinting"], t: T0 + 1000 }),
    );
    const d = detections.find(
      (x) => x.ruleId === "profiling.fingerprinting_classified_in_ad_context",
    )!;
    expect(d.severity).toBe("suspicious");
  });

  it("D-rule combinations", () => {
    const h = new Harness();
    const run = (markers: string[], host: string) =>
      h.ingest(ev({ host, eventType: "response_inspected", inspection: { markers } })).detections;
    const dyn = run(
      ["js.new_function", "js.timer_polling", "js.aes_cbc", "js.colocated_dynamic_transport"],
      "d1.synthetic-benign.test",
    );
    expect(
      run(["js.new_function", "js.timer_polling", "js.aes_cbc"], "d1b.synthetic-benign.test"),
    ).toEqual([]);
    expect(dyn.find((d) => d.ruleId === "js.dynamic_code_with_transport")!.severity).toBe(
      "suspicious",
    );
    expect(run(["js.new_function", "js.websocket"], "d2.synthetic-benign.test")).toEqual([]);
    const cookie = run(
      ["js.cookie_read", "js.cookie_tilde_join", "js.colocated_cookie_exfil"],
      "d3.synthetic-benign.test",
    );
    expect(cookie.find((d) => d.ruleId === "js.cookie_exfil_pattern")!.severity).toBe("elevated");
    const doh = run(["js.doh_cloudflare", "js.raw_ip_fetch"], "d4.synthetic-benign.test");
    expect(doh.find((d) => d.ruleId === "js.doh_then_raw_ip")!.confidence).toBe("medium");
    const trap = run(
      ["js.error_stack_trap", "js.obfuscation_bang_bracket"],
      "d5.synthetic-benign.test",
    );
    expect(trap.find((d) => d.ruleId === "js.anti_analysis_trap")!.severity).toBe("suspicious");
    const iframeLow = run(["js.iframe_create", "js.iframe_1x1"], "d6.synthetic-benign.test");
    expect(iframeLow.find((d) => d.ruleId === "js.hidden_iframe_injection")!.confidence).toBe(
      "low",
    );
  });

  it("D rules ignore non-inspection events", () => {
    const h = new Harness();
    const e = ev({ host: "d7.synthetic-benign.test", eventType: "request_completed" });
    e.responseInspection = {
      observedBytes: 1,
      truncated: false,
      textDecodable: true,
      markers: ["js.adfection_sdk_auth", "js.adfection_sdk_ready"],
    };
    expect(h.ingest(e).detections.filter((d) => d.category === "javascript_technique")).toEqual([]);
  });

  it("missingVisibility reflects event limitations and absent capabilities", () => {
    const h = new Harness({ caps: ["request_metadata"] });
    const { detections } = h.ingest(
      ev({ host: "c2.synthetic-adfection.test", limitations: ["from_cache"] }),
    );
    const mv = detections[0]!.missingVisibility.join(" ");
    expect(mv).toMatch(/cache/);
    expect(mv).toMatch(/Response bodies cannot be inspected/);
  });
});

describe("bundled indicator set (read-only)", () => {
  it("a documented C2 domain from the bundled set yields a malicious-contact detection", () => {
    const h = new Harness({ matcher: loadBundledMatcher() });
    const { detections } = h.ingest(ev({ host: "fearevolve.com" }));
    expect(detections.map((d) => d.ruleId)).toContain("known_infra.malicious_contact");
  });
  it("unrelated hosts produce no detections with the bundled set", () => {
    const m = loadBundledMatcher();
    expect(m.size).toBeGreaterThan(0);
    const h = new Harness({ matcher: m });
    expect(h.ingestAll([ev({ host: "www.example.org" })])).toEqual([]);
  });
});
