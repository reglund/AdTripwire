import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "@adtripwire/shared";
import {
  badgeFor,
  exposureStory,
  sightingText,
  summarizeExposure,
  type IndicatorInfo,
} from "./exposure-summary.js";
import { det, ev, T0 } from "./test-fixtures.js";

const INDICATORS = new Map<string, IndicatorInfo>([
  [
    "syn-myweb",
    {
      id: "syn-myweb",
      indicator: "events.myweb3id.test",
      classification: "surveillance",
      role: "delivery",
      source: "The Citizen Lab — Exposing AdFection",
      sourceUrl: "https://citizenlab.ca/x",
      notes: "Delivery / logging host named in the report body.",
    },
  ],
  [
    "syn-trac",
    {
      id: "syn-trac",
      indicator: "tracookiepixel.test",
      classification: "surveillance",
      role: "tracking",
      source: "The Citizen Lab — Exposing AdFection",
      sourceUrl: "https://citizenlab.ca/x",
    },
  ],
  [
    "syn-c2",
    {
      id: "syn-c2",
      indicator: "c2.synthetic-adfection.test",
      classification: "malicious",
      role: "c2",
      source: "The Citizen Lab — Exposing AdFection",
      sourceUrl: "https://citizenlab.ca/x",
    },
  ],
]);

function contactEvent(
  id: string,
  host: string,
  path: string,
  params: string[],
  top: string,
  doc: string,
  ts: number,
): NormalizedEvent {
  return ev({
    eventId: id,
    timestamp: ts,
    eventType: "request_started",
    resourceType: "image",
    destination: {
      scheme: "https",
      hostname: host,
      pathPattern: path,
      queryParamNames: params,
      redacted: false,
    },
    frameContext: {
      frameId: 4,
      parentFrameId: 0,
      topHostname: top,
      documentHostname: doc,
      ancestorHostnames: [top],
      depth: 1,
      thirdParty: true,
    },
  });
}

const DAY = 86_400_000;
const events = new Map<string, NormalizedEvent>([
  [
    "e1",
    contactEvent(
      "e1",
      "events.myweb3id.test",
      "/cookie-sync/yandex",
      ["userid"],
      "ria.test",
      "yastatic.test",
      T0,
    ),
  ],
  [
    "e2",
    contactEvent(
      "e2",
      "events.myweb3id.test",
      "/cookie-sync/yandex",
      ["userid"],
      "lenta.test",
      "yastatic.test",
      T0 + DAY,
    ),
  ],
  [
    "e3",
    contactEvent(
      "e3",
      "tracookiepixel.test",
      "/log",
      ["bdsp_uid", "gdpr"],
      "goal.test",
      "match.bidr.test",
      T0 + 2 * DAY,
    ),
  ],
]);
const byIds = (ids: readonly string[]) =>
  ids.flatMap((i) => (events.has(i) ? [events.get(i)!] : []));

const detections = [
  det({
    detectionId: "d1",
    ruleId: "known_infra.surveillance_contact",
    severity: "suspicious",
    timestamp: T0,
    firstEventTimestamp: T0,
    eventIds: ["e1"],
    matchedIndicatorIds: ["syn-myweb"],
    subjectHostnames: ["events.myweb3id.test"],
  }),
  det({
    detectionId: "d2",
    ruleId: "known_infra.surveillance_contact",
    severity: "suspicious",
    timestamp: T0 + DAY,
    firstEventTimestamp: T0 + DAY,
    eventIds: ["e2"],
    matchedIndicatorIds: ["syn-myweb"],
    subjectHostnames: ["events.myweb3id.test"],
    occurrenceCount: 2,
  }),
  det({
    detectionId: "d3",
    ruleId: "known_infra.surveillance_contact",
    severity: "suspicious",
    timestamp: T0 + 2 * DAY,
    firstEventTimestamp: T0 + 2 * DAY,
    eventIds: ["e3"],
    matchedIndicatorIds: ["syn-trac"],
    subjectHostnames: ["tracookiepixel.test"],
  }),
  det({
    detectionId: "d4",
    ruleId: "ad_delivery.redirect_chain",
    severity: "informational",
    subjectHostnames: ["x.test"],
  }),
];

describe("summarizeExposure", () => {
  it("groups contacts per documented host with sites, ad frames, days and counts", () => {
    const s = summarizeExposure(detections, byIds, INDICATORS, { now: T0 + 3 * DAY });
    expect(s.contacts.map((c) => c.host)).toEqual(["tracookiepixel.test", "events.myweb3id.test"]);
    const my = s.contacts.find((c) => c.host === "events.myweb3id.test")!;
    expect(my.count).toBe(3);
    expect(my.sites).toEqual(["lenta.test", "ria.test"]);
    expect(my.via).toEqual(["yastatic.test"]);
    expect(my.days).toHaveLength(2);
    expect(my.paramNames).toEqual(["userid"]);
    expect(my.latestDetectionId).toBe("d2");
    expect(my.sourceTitle).toMatch(/Citizen Lab/);
    expect(s.recentHosts).toBe(2);
    expect(s.recentContacts).toBe(4);
    expect(s.strongSignals).toBe(0);
  });

  it("puts malicious contacts first and counts strong signals", () => {
    const extra = [
      ...detections,
      det({
        detectionId: "d5",
        ruleId: "known_infra.malicious_contact",
        severity: "elevated",
        timestamp: T0,
        firstEventTimestamp: T0,
        matchedIndicatorIds: ["syn-c2"],
        subjectHostnames: ["c2.synthetic-adfection.test"],
      }),
    ];
    const s = summarizeExposure(extra, byIds, INDICATORS, { now: T0 + 3 * DAY });
    expect(s.contacts[0]!.classification).toBe("malicious");
    expect(s.strongSignals).toBe(1);
  });

  it("returns an empty summary when nothing documented was contacted", () => {
    const s = summarizeExposure([detections[3]!], byIds, INDICATORS);
    expect(s.contacts).toEqual([]);
    expect(badgeFor(s).text).toBe("");
  });

  it("excludes old contacts from the recent counts", () => {
    const s = summarizeExposure(detections, byIds, INDICATORS, { now: T0 + 30 * DAY });
    expect(s.contacts).toHaveLength(2);
    expect(s.recentHosts).toBe(0);
  });
});

describe("exposureStory and sightingText", () => {
  const s = summarizeExposure(detections, byIds, INDICATORS, { now: T0 + 3 * DAY });
  const my = s.contacts.find((c) => c.host === "events.myweb3id.test")!;

  it("tells the story in plain, conservative language", () => {
    const story = exposureStory(my);
    expect(story.headline).toBe("events.myweb3id.test was contacted 3 times on 2 different days");
    expect(story.body).toMatch(
      /On lenta\.test, ria\.test, an identifier sync .* by an ad frame from yastatic\.test/,
    );
    expect(story.meaning).toMatch(/not evidence of targeting/);
    for (const t of Object.values(story))
      expect(t).not.toMatch(/\binfected\b|\bspied\b|\bis safe\b|\bcompromised\b/i);
  });

  it("writes a sanitized sighting note without values", () => {
    const text = sightingText(my, "0.2.0", "chromium");
    expect(text).toMatch(/^Sighting of documented AdFection infrastructure \(TLP:CLEAR\)/);
    expect(text).toContain("Issuing ad frame(s): yastatic.test");
    expect(text).toContain("Query parameter names (values never stored): userid");
    expect(text).toMatch(/not evidence of targeting/);
  });
});

describe("badgeFor", () => {
  it("shows the recent contact count, coloured by class", () => {
    const s = summarizeExposure(detections, byIds, INDICATORS, { now: Date.now() });
    // Fixture timestamps are in the past relative to Date.now(), so recompute with a recent window.
    const recentSummary = {
      ...s,
      contacts: s.contacts.map((c) => ({ ...c, lastSeen: Date.now() })),
      recentContacts: 4,
      recentHosts: 2,
    };
    const b = badgeFor(recentSummary);
    expect(b.text).toBe("4");
    expect(b.color).toBe("#b26b00");
    expect(b.title).toMatch(/4 time\(s\) \(2 host\(s\)\)/);
  });

  it("switches to an exclamation mark for strong signals", () => {
    const s = summarizeExposure(detections, byIds, INDICATORS);
    expect(badgeFor({ ...s, strongSignals: 2 }).text).toBe("!");
  });
});
