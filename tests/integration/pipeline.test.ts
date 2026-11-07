/**
 * Synthetic end-to-end scenarios through the REAL pipeline:
 * webRequest-like details → sensor-firefox event builder / stream filter → detection engine.
 * All hostnames are reserved .test names; nothing touches the network.
 */
import { describe, expect, it } from "vitest";
import type {
  Detection,
  IndicatorSet,
  NormalizedEvent,
  SensorCapabilities,
} from "@adtripwire/shared";
import { DEFAULT_SETTINGS } from "@adtripwire/shared";
import {
  IndicatorMatcher,
  validateIndicatorSet,
  BUNDLED_INDICATOR_SETS,
} from "@adtripwire/indicators";
import {
  DetectionEngine,
  MemoryExposureStore,
  analyzeJavaScript,
} from "@adtripwire/detection-engine";
import {
  attachPassThroughInspector,
  buildEvent,
  buildInspectionEvent,
  type InspectionResult,
  type RequestDetailsLike,
  type StreamFilterLike,
} from "@adtripwire/sensor-firefox";
import { buildEvidenceExport, serializeExport } from "@adtripwire/privacy";
import { AlongsideTracker, listAlongside } from "@adtripwire/correlation";
import syntheticJson from "../fixtures/indicators/synthetic.json";

const synthetic = (() => {
  const v = validateIndicatorSet(syntheticJson);
  if (!v.ok) throw new Error(v.errors.join("; "));
  return v.set as IndicatorSet;
})();

const matcher = new IndicatorMatcher([synthetic]);

const FIREFOX_CAPS: SensorCapabilities = {
  browser: "firefox",
  browserVersion: "157.0",
  capabilities: [
    "request_metadata",
    "redirect_chain",
    "response_headers",
    "response_size",
    "response_body_inspection",
    "frame_ancestry",
    "third_party_flag",
    "url_classification",
  ],
  notes: [],
};
const CHROMIUM_CAPS: SensorCapabilities = {
  browser: "chromium",
  capabilities: ["request_metadata", "redirect_chain", "response_headers", "response_size"],
  notes: [],
};

const PUBLISHER = "https://news.synthetic-publisher.test/article/42";
const AD_FRAME = "https://ad.synthetic-exchange.test/creative.html";
const T0 = 1_800_000_000_000;

class Harness {
  readonly engine: DetectionEngine;
  readonly detections: Detection[] = [];
  readonly updated: Detection[] = [];
  readonly events: NormalizedEvent[] = [];
  /** Optional "seen alongside" tracker, fed after every ingest (like the background does). */
  readonly tracker: AlongsideTracker | undefined;
  /** Set when the tracker changed an event it was handed (it must never). */
  trackerMutatedEvent = false;
  now = T0;
  private reqCounter = 1;
  constructor(
    caps: SensorCapabilities = FIREFOX_CAPS,
    opts: { matcher?: IndicatorMatcher; windowMs?: number; tracker?: boolean } = {},
  ) {
    this.engine = new DetectionEngine({
      matcher: opts.matcher ?? new IndicatorMatcher([synthetic]),
      capabilities: caps,
      settings: {
        ...DEFAULT_SETTINGS.monitoring,
        correlationWindowMs: opts.windowMs ?? DEFAULT_SETTINGS.monitoring.correlationWindowMs,
      },
      exposure: new MemoryExposureStore(),
      now: () => this.now,
    });
    if (opts.tracker) this.tracker = new AlongsideTracker({ matcher: () => matcher });
  }
  ingest(ev: NormalizedEvent | null): void {
    if (!ev) throw new Error("event could not be built");
    const r = this.engine.ingest(ev);
    if (this.tracker) {
      const before = JSON.stringify(r.event);
      this.tracker.observe(r.event, () => this.engine.window.recent());
      if (JSON.stringify(r.event) !== before) this.trackerMutatedEvent = true;
    }
    this.events.push(r.event);
    this.detections.push(...r.detections);
    this.updated.push(...r.updated);
    // Escalated/updated detections replace their earlier version, as the background store does.
    for (const u of r.updated) {
      const i = this.detections.findIndex((d) => d.detectionId === u.detectionId);
      if (i >= 0) this.detections[i] = u;
    }
  }
  details(url: string, extra: Partial<RequestDetailsLike> = {}): RequestDetailsLike {
    const inAdFrame = extra.frameId === undefined || extra.frameId > 0;
    return {
      requestId: String(this.reqCounter++),
      url,
      method: "GET",
      type: "script",
      tabId: 1,
      frameId: inAdFrame ? 5 : 0,
      parentFrameId: inAdFrame ? 0 : -1,
      timeStamp: this.now,
      originUrl: inAdFrame ? AD_FRAME : PUBLISHER,
      documentUrl: inAdFrame ? AD_FRAME : PUBLISHER,
      frameAncestors: inAdFrame
        ? [
            { url: AD_FRAME, frameId: 5 },
            { url: PUBLISHER, frameId: 0 },
          ]
        : [],
      thirdParty: true,
      urlClassification: { firstParty: [], thirdParty: [] },
      ...extra,
    };
  }
  /** Simulates a full request: started → (body via StreamFilter) → completed → response_inspected. */
  async request(
    url: string,
    body: string | null,
    extra: Partial<RequestDetailsLike> = {},
    contentType = "application/javascript",
  ): Promise<void> {
    const d = this.details(url, extra);
    const started = buildEvent("firefox", "started", d)!;
    this.ingest(started);
    let inspection: InspectionResult | undefined;
    if (body !== null) {
      inspection = await runFilter(body);
    }
    this.now += 50;
    const completed = buildEvent("firefox", "completed", {
      ...d,
      timeStamp: this.now,
      statusCode: 200,
      responseHeaders:
        body !== null
          ? [
              { name: "Content-Length", value: String(new TextEncoder().encode(body).length) },
              { name: "Content-Type", value: contentType },
            ]
          : [],
    })!;
    this.ingest(completed);
    if (inspection) {
      inspection.inspection.contentType = contentType;
      this.now += 5;
      this.ingest(buildInspectionEvent(completed, inspection, this.now));
    }
  }
  bySeverity(sev: Detection["severity"]): Detection[] {
    return this.detections.filter((d) => d.severity === sev);
  }
  ruleIds(): string[] {
    return Array.from(new Set(this.detections.map((d) => d.ruleId))).sort();
  }
}

class FakeFilter implements StreamFilterLike {
  ondata: StreamFilterLike["ondata"] = null;
  onstart: StreamFilterLike["onstart"] = null;
  onstop: StreamFilterLike["onstop"] = null;
  onerror: StreamFilterLike["onerror"] = null;
  written = 0;
  released = 0;
  write(d: ArrayBuffer | Uint8Array) {
    this.written += d.byteLength;
  }
  /** Firefox stops delivering ondata after disconnect(); the fake mirrors that. */
  disconnect() {
    this.released++;
    this.ondata = null;
  }
  close() {
    this.released++;
  }
}

function runFilter(body: string, maxBytes = 64 * 1024, chunk = 4096): Promise<InspectionResult> {
  return new Promise((resolve) => {
    const f = new FakeFilter();
    attachPassThroughInspector(f, {
      maxBytes,
      analyzer: (t) => analyzeJavaScript(t),
      defer: (fn) => queueMicrotask(fn),
      onResult: (r) => {
        // Every byte the filter saw was written through; after disconnect Firefox streams natively.
        expect(f.written).toBe(r.inspection.observedBytes);
        expect(f.released).toBe(1);
        resolve(r);
      },
    });
    const bytes = new TextEncoder().encode(body);
    for (let i = 0; i < bytes.length; i += chunk) {
      const slice = bytes.slice(i, i + chunk);
      if (f.ondata)
        f.ondata({
          data: slice.buffer.slice(
            slice.byteOffset,
            slice.byteOffset + slice.byteLength,
          ) as ArrayBuffer,
        });
      if (!f.ondata) break;
    }
    f.onstop?.({});
  });
}

const NOAS =
  "https://noas.synthetic-adfection.test/getAd?idfa=00000000-0000-0000-0000-000000000000&ipv4=192.0.2.1&dom=news.synthetic-publisher.test&os=test&devicemodel=test";
const SELECTED_JS = `(function(){var f=document.createElement("iframe");f.style.cssText="width:1px;height:1px;border:none";f.src="https://staging.synthetic-dsp.test/iframe?impid=x";document.body.appendChild(f);var s=document.createElement("script");s.id="getAdScript";s.src="https://validator.synthetic-adfection.test/check.js";document.body.appendChild(s);})();`;
const SDK_JS = `window.SDK_AUTH={token:"t",expiresAt:0,remainingRequests:10};var s=document.createElement("script");s.src="https://cdn.synthetic-dsp.test/sdk.js?script_tok=abc";window.parent.postMessage({type:"analytics_sdk_ready"},"*");`;

const forbidden = /infected|spied|is safe|are safe|compromised/i;
function assertLanguage(dets: Detection[]) {
  for (const d of dets) {
    expect(d.summary).not.toMatch(forbidden);
    expect(d.significance).not.toMatch(forbidden);
    expect(d.alternativeExplanations.length).toBeGreaterThan(0);
    expect(d.recommendedActions.length).toBeGreaterThan(0);
    expect(d.limitations.length).toBeGreaterThan(0);
    expect(d.references.length).toBeGreaterThan(0);
  }
}

describe("synthetic pipeline scenarios", () => {
  it("1. ordinary advertisement loading produces no detections", async () => {
    const h = new Harness();
    await h.request(
      "https://ads.synthetic-benign.test/ad.js?w=300&h=250&slot=top",
      `document.write("<p>ad</p>");`,
    );
    await h.request(
      "https://ads.synthetic-benign.test/pixel.gif?c=1",
      "GIF89a",
      { type: "image" },
      "image/gif",
    );
    await h.request("https://cdn.synthetic-benign.test/lib.min.js", "!function(e){e.x=1}(window);");
    expect(h.detections).toEqual([]);
  });

  it("2. benign fingerprinting classification alone produces no detections", async () => {
    const h = new Harness();
    await h.request(
      "https://fp.synthetic-antifraud.test/collect.js?sid=1",
      "var c=document.createElement('canvas');",
      {
        urlClassification: { firstParty: [], thirdParty: ["fingerprinting_content"] },
      },
    );
    await h.request(
      "https://fp.synthetic-antifraud.test/collect.js?sid=2",
      "var c=document.createElement('canvas');",
      {
        urlClassification: { firstParty: [], thirdParty: ["fingerprinting"] },
      },
    );
    expect(h.bySeverity("elevated")).toEqual([]);
    expect(h.bySeverity("high_priority")).toEqual([]);
    expect(h.detections.filter((d) => d.severity !== "informational")).toEqual([]);
  });

  it("3. contact with a known malicious test indicator yields an elevated known-infrastructure detection", async () => {
    const h = new Harness();
    await h.request(
      "https://c2.synthetic-adfection.test/pixel.gif?t=1",
      "GIF89a",
      { type: "image" },
      "image/gif",
    );
    expect(h.ruleIds()).toEqual(["known_infra.malicious_contact"]);
    const d = h.detections[0]!;
    expect(d.severity).toBe("elevated");
    expect(d.matchedIndicatorIds).toContain("syn-0001");
    expect(d.confidenceRationale.toLowerCase()).toMatch(/target/);
    assertLanguage(h.detections);
  });

  it("4a. NOAS request with an empty response: exposure, not selection (no elevated beyond the NOAS host match)", async () => {
    const h = new Harness();
    await h.request(NOAS, "");
    const ids = h.ruleIds();
    expect(ids).toContain("known_infra.surveillance_contact");
    expect(ids).toContain("ad_delivery.noas_request");
    expect(ids).toContain("ad_delivery.noas_selective_response");
    const sel = h.detections.find((d) => d.ruleId === "ad_delivery.noas_selective_response")!;
    expect(sel.severity).toBe("informational");
    expect(sel.summary.toLowerCase()).toMatch(/empty|0 bytes|zero/);
    expect(h.bySeverity("high_priority")).toEqual([]);
    assertLanguage(h.detections);
  });

  it("4b. NOAS request returning JavaScript is elevated and the delivered script's markers are detected", async () => {
    const h = new Harness();
    await h.request(NOAS, SELECTED_JS);
    const sel = h.detections.find((d) => d.ruleId === "ad_delivery.noas_selective_response")!;
    expect(sel.severity).toBe("elevated");
    expect(h.ruleIds()).toContain("js.hidden_iframe_injection");
    const insp = h.events.find((e) => e.eventType === "response_inspected")!;
    expect(insp.responseInspection!.markers).toEqual(
      expect.arrayContaining([
        "js.iframe_create",
        "js.iframe_1x1",
        "js.script_inject",
        "js.adfection_getad_script_id",
      ]),
    );
    expect(JSON.stringify(h.events)).not.toContain("00000000-0000-0000-0000-000000000000");
    expect(JSON.stringify(h.events)).not.toContain("192.0.2.1");
  });

  it("5. AdFection SDK markers in an inspected script are elevated", async () => {
    const h = new Harness();
    await h.request("https://cdn.synthetic-dsp.test/loader.js?impid=1", SDK_JS);
    expect(h.ruleIds()).toContain("js.adfection_sdk_markers");
    expect(h.detections.find((d) => d.ruleId === "js.adfection_sdk_markers")!.severity).toBe(
      "elevated",
    );
  });

  it("6. full chain NOAS → selected JS → validator/C2 contact correlates to high priority with observed and inferred evidence", async () => {
    const h = new Harness();
    await h.request(NOAS, SELECTED_JS);
    h.now += 1000;
    await h.request(
      "https://staging.synthetic-dsp.test/iframe?impid=x",
      "<html></html>",
      { type: "sub_frame" },
      "text/html",
    );
    h.now += 1000;
    await h.request(
      "https://validator.synthetic-adfection.test/check.js?q=c3ludGhldGlj",
      "/* ok */",
    );
    const chain = h.detections.filter((d) => d.ruleId === "correlation.adfection_chain");
    expect(chain.length).toBe(1);
    const c = chain[0]!;
    expect(c.severity).toBe("high_priority");
    expect(c.evidence.some((e) => e.kind === "observed")).toBe(true);
    expect(c.evidence.some((e) => e.kind === "inferred")).toBe(true);
    expect(c.eventIds.length).toBeGreaterThanOrEqual(3);
    expect(c.limitations.join(" ").toLowerCase()).toMatch(/causation|proximity/);
    assertLanguage(h.detections);
  });

  it("6c. the same chain with step 3 in a sibling ad frame is reported one level lower (frame lineage)", async () => {
    const h = new Harness();
    await h.request(NOAS, SELECTED_JS);
    h.now += 1000;
    await h.request(
      "https://validator.synthetic-adfection.test/check.js?q=c3ludGhldGlj",
      "/* ok */",
      {
        frameId: 7,
        parentFrameId: 0,
        frameAncestors: [{ url: PUBLISHER, frameId: 0 }],
      },
    );
    const c = h.detections.find((d) => d.ruleId === "correlation.adfection_chain")!;
    expect(c.severity).toBe("elevated");
    expect(
      c.evidence.some(
        (e) => e.kind === "inferred" && /not in the same frame lineage/.test(e.observed),
      ),
    ).toBe(true);
    assertLanguage(h.detections);
  });

  it("6b. the same chain outside the correlation window does not correlate", async () => {
    const h = new Harness(FIREFOX_CAPS, { windowMs: 60_000 });
    await h.request(NOAS, SELECTED_JS);
    h.now += 10 * 60_000;
    await h.request(
      "https://validator.synthetic-adfection.test/check.js?q=c3ludGhldGlj",
      "/* ok */",
    );
    expect(h.detections.filter((d) => d.ruleId === "correlation.adfection_chain")).toEqual([]);
  });

  it("7. false-positive scenario: generic ad server with /getAd path and common params stays below elevated", async () => {
    const h = new Harness();
    await h.request(
      "https://ads.synthetic-benign.test/getAd?slot=top&page=home&dom=x",
      `document.write("ad")`,
    );
    expect(h.bySeverity("elevated")).toEqual([]);
    expect(h.bySeverity("high_priority")).toEqual([]);
  });

  it("7b. first-party scripts with eval/WebSocket are not flagged above informational without ad context", async () => {
    const h = new Harness();
    await h.request(
      "https://news.synthetic-publisher.test/app.js",
      `var ws=new WebSocket("wss://news.synthetic-publisher.test/live");setInterval(function(){},1000);eval("1+1");`,
      {
        frameId: 0,
        thirdParty: false,
      },
    );
    expect(
      h.detections
        .filter((d) => d.severity !== "informational")
        .map((d) => `${d.ruleId}:${d.severity}`),
    ).toEqual([]);
  });

  it("8. large and malformed responses are handled: pass-through intact, analysis truncated, binary tolerated", async () => {
    const big = "var x=1;".repeat(100_000); // 800 KB
    const r = await runFilter(big, 64 * 1024);
    expect(r.inspection.truncated).toBe(true);
    // observedBytes is a lower bound once truncated: the remainder streamed natively after disconnect.
    expect(r.inspection.observedBytes).toBeGreaterThanOrEqual(64 * 1024);
    expect(r.inspection.observedBytes).toBeLessThan(big.length);
    expect(r.limitations).toContain("response_body_truncated");
    const bin = String.fromCharCode(...Array.from({ length: 300 }, (_, i) => 0xd800 + (i % 50))); // lone surrogates → invalid
    const rb = await runFilter(bin, 64 * 1024);
    expect(rb.inspection.markers).toEqual([]);
    const h = new Harness();
    await h.request(NOAS, big);
    expect(
      h.detections.find((d) => d.ruleId === "ad_delivery.noas_selective_response")!.severity,
    ).toBe("elevated");
    const insp = h.events.find((e) => e.eventType === "response_inspected")!;
    expect(insp.evidenceQuality).toBe("partial");
  });

  it("9. events with incomplete metadata (Chromium-like) still match indicators but body rules are not evaluable", async () => {
    const h = new Harness(CHROMIUM_CAPS);
    const d = h.details("https://c2.synthetic-adfection.test/x.js");
    delete d.frameAncestors;
    delete d.urlClassification;
    delete d.thirdParty;
    h.ingest(buildEvent("unknown", "started", d));
    expect(h.ruleIds()).toContain("known_infra.malicious_contact");
    const rules = h.engine.listRules();
    const notEvaluable = rules.filter((r) => !r.evaluable).map((r) => r.definition.id);
    expect(notEvaluable).toEqual(
      expect.arrayContaining([
        "js.adfection_sdk_markers",
        "js.hidden_iframe_injection",
        "correlation.adfection_chain",
      ]),
    );
    expect(h.events[0]!.observationLimitations).toContain("frame_ancestry_unavailable");
  });

  it("10. extension restart mid-chain: snapshot/restore keeps correlation and dedup state", async () => {
    const h = new Harness();
    await h.request(NOAS, SELECTED_JS);
    const snap = h.engine.snapshot();
    const restored = DetectionEngine.restore(JSON.parse(JSON.stringify(snap)), {
      matcher: new IndicatorMatcher([synthetic]),
      capabilities: FIREFOX_CAPS,
      settings: DEFAULT_SETTINGS.monitoring,
      exposure: new MemoryExposureStore(),
      now: () => h.now,
    });
    h.now += 2000;
    const d = h.details("https://validator.synthetic-adfection.test/check.js?q=abc");
    const r = restored.ingest(buildEvent("firefox", "started", d)!);
    expect(r.detections.map((x) => x.ruleId)).toContain("correlation.adfection_chain");
    // Re-ingesting the NOAS request after restore dedups instead of re-detecting.
    const again = restored.ingest(buildEvent("firefox", "started", h.details(NOAS))!);
    expect(again.detections.filter((x) => x.ruleId === "known_infra.surveillance_contact")).toEqual(
      [],
    );
    expect(
      again.updated.some(
        (x) => x.ruleId === "known_infra.surveillance_contact" && x.occurrenceCount >= 2,
      ),
    ).toBe(true);
  });

  it("bundled real indicator set never matches synthetic hosts and vice versa", () => {
    const real = new IndicatorMatcher(BUNDLED_INDICATOR_SETS);
    expect(real.match("c2.synthetic-adfection.test")).toEqual([]);
    expect(real.match("noas.synthetic-adfection.test", "/getAd")).toEqual([]);
    const syn = new IndicatorMatcher([synthetic]);
    expect(syn.match("noas.mtrtb.com", "/getAd")).toEqual([]);
    expect(real.match("noas.mtrtb.com", "/getAd").map((m) => m.indicator.classification)).toContain(
      "surveillance",
    );
    expect(real.match("keyadapter.com")[0]!.indicator.classification).toBe("malicious");
    expect(real.match("notmtrtb.com")).toEqual([]);
  });

  it("evidence export of a chain is redacted and carries the disclaimer", async () => {
    const h = new Harness();
    await h.request(NOAS, SELECTED_JS);
    h.now += 1000;
    await h.request(
      "https://validator.synthetic-adfection.test/check.js?q=c3ludGhldGlj",
      "/* ok */",
    );
    const ids = new Set(h.detections.flatMap((d) => d.eventIds));
    const exp = buildEvidenceExport({
      productVersion: "0.1.0-test",
      browser: FIREFOX_CAPS,
      rulesetVersion: h.engine.rulesetVersion,
      indicatorSets: [synthetic.meta],
      detections: h.detections,
      events: h.events.filter((e) => ids.has(e.eventId)),
      profile: "default",
    });
    const json = serializeExport(exp);
    expect(json).toContain("Absence of detections is not evidence");
    expect(json).not.toContain("c3ludGhldGlj");
    expect(json).not.toContain("192.0.2.1");
    expect(json).not.toMatch(/[?&][a-z]+=[A-Za-z0-9]/);
    expect(exp.detections.length).toBe(h.detections.length);
    const strict = buildEvidenceExport({
      ...{
        productVersion: "x",
        browser: FIREFOX_CAPS,
        rulesetVersion: "r",
        indicatorSets: [synthetic.meta],
        detections: h.detections,
        events: h.events.filter((e) => ids.has(e.eventId)),
      },
      profile: "strict",
    });
    expect(serializeExport(strict)).not.toContain("news.synthetic-publisher.test");
  });
});

describe("seen alongside (observation only)", () => {
  const CREATIVE = "https://creative.synthetic-cdn.test/pixel.gif?c=1";

  /** The /selected scenario plus the non-indicator creative host inside the ad frame. */
  async function selectedScenario(h: Harness): Promise<void> {
    await h.request(NOAS, SELECTED_JS);
    h.now += 500;
    await h.request(CREATIVE, "GIF89a", { type: "image" }, "image/gif");
    h.now += 500;
    await h.request(
      "https://staging.synthetic-dsp.test/iframe?impid=x",
      "<html></html>",
      { type: "sub_frame" },
      "text/html",
    );
    h.now += 1000;
    await h.request(
      "https://validator.synthetic-adfection.test/check.js?q=c3ludGhldGlj",
      "/* ok */",
    );
    await h.request("https://ads.synthetic-benign.test/ad.js?w=300", "x=1;");
  }

  /** Event ids and timestamps are random/clock-bound; everything a user sees is compared. */
  const shape = (ds: Detection[]) =>
    ds
      .map((d) => ({
        ruleId: d.ruleId,
        severity: d.severity,
        confidence: d.confidence,
        summary: d.summary,
        dedupKey: d.dedupKey,
        occurrenceCount: d.occurrenceCount,
        eventCount: d.eventIds.length,
        indicators: [...d.matchedIndicatorIds].sort(),
        subjects: [...d.subjectHostnames].sort(),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  it("never changes a detection: identical with and without the tracker", async () => {
    const without = new Harness();
    const withT = new Harness(FIREFOX_CAPS, { tracker: true });
    await selectedScenario(without);
    await selectedScenario(withT);
    expect(withT.detections.length).toBeGreaterThan(0);
    expect(shape(withT.detections)).toEqual(shape(without.detections));
    expect(withT.trackerMutatedEvent).toBe(false);
    expect(withT.tracker!.store.totals.anchorsSeen).toBeGreaterThan(0);
  });

  it("lists the non-indicator creative host alongside the NOAS anchor, never indicator hosts", async () => {
    const h = new Harness(FIREFOX_CAPS, { tracker: true });
    await selectedScenario(h);
    const store = h.tracker!.store;
    expect(store.get("creative.synthetic-cdn.test")?.frameDays).toHaveLength(1);
    expect(store.get("creative.synthetic-cdn.test")?.anchors).toContain("syn-0003");
    // Two UTC days of the same observation make it eligible for the ranked list.
    store.record("creative.synthetic-cdn.test", "syn-0003", "frame", "2025-12-31");
    const out = listAlongside(store, { distinctDays: () => 2 });
    const row = out.rows.find((r) => r.hostname === "creative.synthetic-cdn.test");
    expect(row?.anchors).toContain("syn-0003");
    expect(row?.frameDays).toBe(2);
    for (const [host] of store.entries()) {
      expect(matcher.match(host).length).toBe(0);
      expect(host).not.toBe("staging.synthetic-dsp.test");
      expect(host).not.toBe("c2.synthetic-adfection.test");
    }
    // Privacy: hostnames only, none of the page hosts, no path/query characters.
    const json = JSON.stringify(store.toJSON());
    expect(json).not.toContain("news.synthetic-publisher.test");
    expect(json).not.toContain("pixel.gif");
    expect(
      [...json.matchAll(/"([^"]*)"/g)].map((m) => m[1]!).filter((v) => /[/?=]/.test(v)),
    ).toEqual([]);
  });

  it("/benign records nothing", async () => {
    const h = new Harness(FIREFOX_CAPS, { tracker: true });
    await h.request("https://ads.synthetic-benign.test/ad.js?w=300&h=250&slot=top", "x=1;");
    await h.request("https://cdn.synthetic-benign.test/lib.min.js", "!function(e){e.x=1}(window);");
    expect(h.tracker!.store.size).toBe(0);
    expect(h.tracker!.store.totals.anchorsSeen).toBe(0);
  });

  it("a heuristic-only detection (redirect chain, no indicator) opens no anchor", async () => {
    const h = new Harness(FIREFOX_CAPS, { tracker: true });
    await h.request("https://ads.synthetic-benign.test/getAd?slot=top&page=home&dom=x", "x=1;");
    await h.request("https://cdn.synthetic-benign.test/lib.min.js", "x=1;");
    expect(h.tracker!.store.totals.anchorsSeen).toBe(0);
    expect(h.tracker!.store.size).toBe(0);
  });
});
