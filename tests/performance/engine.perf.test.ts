import { describe, expect, it } from "vitest";
import type { NormalizedEvent, SensorCapabilities } from "@adtripwire/shared";
import { DEFAULT_SETTINGS } from "@adtripwire/shared";
import { IndicatorMatcher, BUNDLED_INDICATOR_SETS } from "@adtripwire/indicators";
import {
  DetectionEngine,
  MemoryExposureStore,
  analyzeJavaScript,
} from "@adtripwire/detection-engine";
import { sanitizeUrl } from "@adtripwire/privacy";

const caps: SensorCapabilities = {
  browser: "firefox",
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

function mkEvent(i: number, now: number): NormalizedEvent {
  const host = `h${i % 5000}.synthetic-cdn${i % 7}.test`;
  return {
    eventId: `e${i}`,
    timestamp: now,
    browser: "firefox",
    sensor: "webrequest",
    eventType: i % 3 === 0 ? "request_completed" : "request_started",
    requestId: String(i >> 1),
    tabId: i % 20,
    destination: sanitizeUrl(`https://${host}/path/${i}/asset.js?w=300&h=250&cb=${i}`)!,
    resourceType: i % 4 === 0 ? "image" : "script",
    frameContext: {
      frameId: 3,
      parentFrameId: 0,
      ancestorHostnames: ["ad.synthetic-exchange.test", "pub.synthetic-site.test"],
      depth: 2,
      thirdParty: true,
    },
    requestStatus: "started",
    matchedIndicators: [],
    matchedRules: [],
    evidenceQuality: "direct",
    observationLimitations: [],
  };
}

describe("engine performance bounds", () => {
  it("ingests 50k third-party events quickly with a bounded window", () => {
    let now = 1_800_000_000_000;
    const engine = new DetectionEngine({
      matcher: new IndicatorMatcher(BUNDLED_INDICATOR_SETS),
      capabilities: caps,
      settings: DEFAULT_SETTINGS.monitoring,
      exposure: new MemoryExposureStore(),
      now: () => now,
    });
    const N = 50_000;
    const t0 = performance.now();
    let detections = 0;
    for (let i = 0; i < N; i++) {
      now += 7;
      detections += engine.ingest(mkEvent(i, now)).detections.length;
    }
    const ms = performance.now() - t0;
    const perEvent = ms / N;
    console.log(
      `ingest: ${N} events in ${ms.toFixed(0)} ms (${(perEvent * 1000).toFixed(1)} µs/event), window=${engine.window.size}, detections=${detections}`,
    );
    expect(perEvent).toBeLessThan(0.2); // < 200 µs per event on CI-class hardware
    expect(engine.window.size).toBeLessThanOrEqual(5000);
    expect(detections).toBe(0); // benign synthetic traffic must not fire on the real set
  });

  it("analyses a 512 KB script within budget and caps input", () => {
    const src = `function a(){var x=document.createElement("div");x.id="y";return x}`.repeat(8000); // ~520 KB
    const t0 = performance.now();
    const r = analyzeJavaScript(src);
    const ms = performance.now() - t0;
    console.log(
      `analyzer: ${src.length} chars in ${ms.toFixed(1)} ms, markers=${r.markers.length}`,
    );
    expect(ms).toBeLessThan(500);
    expect(r.stats.length).toBeLessThanOrEqual(262_144);
  });

  it("sanitizes 100k URLs within budget", () => {
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++)
      sanitizeUrl(
        `https://h${i}.synthetic.test/u/${i.toString(16).padStart(32, "a")}/x?idfa=${i}&cookie=a~~~b`,
      );
    const ms = performance.now() - t0;
    console.log(`sanitizeUrl: 100k in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });

  it("snapshot/restore of a full window is bounded in size", () => {
    let now = 1_800_000_000_000;
    const engine = new DetectionEngine({
      matcher: new IndicatorMatcher(BUNDLED_INDICATOR_SETS),
      capabilities: caps,
      settings: DEFAULT_SETTINGS.monitoring,
      now: () => now,
    });
    for (let i = 0; i < 6000; i++) {
      now += 10;
      engine.ingest(mkEvent(i, now));
    }
    const json = JSON.stringify(engine.snapshot());
    console.log(`snapshot: ${(json.length / 1024).toFixed(0)} KB for ${engine.window.size} events`);
    expect(json.length).toBeLessThan(8 * 1024 * 1024);
  });
});
