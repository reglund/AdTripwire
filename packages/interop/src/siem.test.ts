import { describe, expect, it } from "vitest";
import { detectionsToEcsNdjson, eventsToEcsNdjson } from "./siem.js";
import { CAPS, INITIATOR, TOP_SITE, makeDetection, makeEvents, makeSet } from "./test-fixtures.js";

const opts = {
  productVersion: "0.4.0",
  rulesetVersion: "2026.11.02",
  browser: CAPS,
  now: new Date("2026-11-02T12:00:00.000Z"),
  indicatorSets: [makeSet()],
};

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function parse(ndjson: string): Doc[] {
  expect(ndjson.endsWith("\n")).toBe(true);
  return ndjson
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Doc);
}

function urlFields(doc: Doc): string[] {
  return doc["url"] ? Object.values(doc["url"]).map(String) : [];
}

describe("detectionsToEcsNdjson", () => {
  const severities = ["informational", "suspicious", "elevated", "high_priority"] as const;
  const dets = severities.map((s, i) => makeDetection({ detectionId: `det-${i}`, severity: s }));
  const text = detectionsToEcsNdjson(dets, makeEvents(), opts);
  const docs = parse(text);

  it("emits one parseable ECS alert per detection with the required fields", () => {
    expect(docs).toHaveLength(4);
    for (const d of docs) {
      expect(d["@timestamp"]).toBe("2026-09-21T14:13:20.500Z");
      expect(d.ecs.version).toBe("8.11.0");
      expect(d.event.kind).toBe("alert");
      expect(d.event.category).toEqual(["network", "threat"]);
      expect(d.event.type).toEqual(["indicator", "info"]);
      expect(d.event.module).toBe("adtripwire");
      expect(d.event.dataset).toBe("adtripwire.detection");
      expect(d.event.id).toMatch(/^det-/);
      expect(d.rule).toMatchObject({
        id: "known_infra.malicious_contact",
        version: "1.0.0",
        category: "known_infrastructure",
      });
      expect(d.message).toContain("Observed traffic");
      expect(d.observer).toMatchObject({
        vendor: "AdTripwire",
        product: "AdTripwire Firefox",
        version: "0.4.0",
      });
      expect(d.related.hosts).toEqual(["c2.evil-host.test", "shared-bucket.cdn.test"]);
      expect(d.adtripwire.confidence).toBe("medium");
      expect(d.adtripwire.confidence_rationale).toContain("Exact hostname");
      expect(d.adtripwire.alternative_explanations).toHaveLength(1);
      expect(d.adtripwire.limitations).toEqual(["Browser-only visibility."]);
      expect(d.adtripwire.missing_visibility).toHaveLength(1);
      expect(d.adtripwire.event_ids).toHaveLength(2);
      expect(d.adtripwire.occurrence_count).toBe(3);
      expect(d.adtripwire.frame_depth_max).toBe(2);
    }
  });

  it("maps severity and risk score", () => {
    expect(docs.map((d) => d.event.severity)).toEqual([1, 3, 5, 7]);
    expect(docs.map((d) => d.event.risk_score)).toEqual([10, 30, 50, 70]);
  });

  it("expands matched indicators into threat fields", () => {
    const t = docs[0]!.threat;
    expect(t.indicator).toMatchObject({
      type: "domain-name",
      name: "c2.evil-host.test",
      confidence: "High",
      provider: "Synthetic Lab",
      reference: "https://report.example.test/adfection",
    });
    expect(t.enrichments).toHaveLength(2);
    expect(t.enrichments[1].indicator).toMatchObject({
      type: "url",
      name: "shared-bucket.cdn.test/Campaign_Path/",
    });
  });

  it("carries no query values, top-site or initiator hosts", () => {
    expect(text).not.toContain("abc123secret");
    expect(text).not.toContain("token=");
    expect(text).not.toContain(TOP_SITE);
    expect(text).not.toContain(INITIATOR);
    const chromium = parse(
      detectionsToEcsNdjson(dets.slice(0, 1), [], {
        ...opts,
        browser: { ...CAPS, browser: "chromium" },
      }),
    );
    expect(chromium[0]!.observer.product).toBe("AdTripwire Chromium");
    expect(detectionsToEcsNdjson([], [], opts)).toBe("");
  });
});

describe("eventsToEcsNdjson", () => {
  const events = makeEvents();
  events.push({
    ...events[0]!,
    eventId: "33333333-3333-4333-8333-333333333333",
    destination: { ...events[0]!.destination, pathPattern: "/weird?x=1#frag" },
  });
  const text = eventsToEcsNdjson(events, opts);
  const docs = parse(text);

  it("emits ECS event documents with url/http/network fields", () => {
    expect(docs).toHaveLength(3);
    const first = docs[0]!;
    expect(first.event).toMatchObject({
      kind: "event",
      dataset: "adtripwire.observation",
      module: "adtripwire",
    });
    expect(first.url).toEqual({
      domain: "c2.evil-host.test",
      path: "/u/{id}/track",
      scheme: "https",
    });
    expect(first.http).toEqual({
      request: { method: "GET" },
      response: { status_code: 200, bytes: 1234 },
    });
    expect(first.network.protocol).toBe("http");
    expect(first.adtripwire.frame.depth).toBe(2);
    expect(first["@timestamp"]).toMatch(/Z$/);
    const { statusCode: _s, responseSizeIfObservable: _r, method: _m, ...bare } = events[0]!;
    const minimal = parse(eventsToEcsNdjson([bare], opts))[0]!;
    expect(minimal.http).toBeUndefined();
  });

  it("never puts ? or = into url.* fields", () => {
    for (const d of docs) for (const v of urlFields(d)) expect(v).not.toMatch(/[?=]/);
    expect(text).not.toContain("x=1");
    expect(text).not.toContain("frag");
    expect(text).not.toContain(TOP_SITE);
    expect(text).not.toContain(INITIATOR);
  });
});
