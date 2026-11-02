import type {
  Detection,
  NormalizedEvent,
  SensorCapabilities,
  IndicatorSetMeta,
} from "@adtripwire/shared";

export const SUBJECT = "noas.mtrtb.com";
export const TOP = "secret-news-site.example.org";
export const AD_FRAME = "adframe.tracker-cdn.net";
export const INITIATOR_HOST = "initiator.private-blog.example.net";

export function makeEvent(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    timestamp: 1_700_000_000_000,
    browser: "firefox",
    sensor: "webrequest",
    eventType: "request_started",
    requestId: "42",
    tabId: 7,
    initiatorOrigin: `https://${INITIATOR_HOST}`,
    destination: {
      scheme: "https",
      hostname: SUBJECT,
      pathPattern: "/u/{id}/track",
      queryParamNames: ["idfa", "ipv4", "page", "utm_source"],
      redacted: true,
    },
    resourceType: "xmlhttprequest",
    method: "GET",
    frameContext: {
      frameId: 3,
      parentFrameId: 0,
      documentHostname: AD_FRAME,
      topHostname: TOP,
      ancestorHostnames: [AD_FRAME, TOP],
      depth: 1,
      thirdParty: true,
    },
    requestStatus: "started",
    redirectHostname: "redirect.other-tracker.io",
    correlationId: `corr-${TOP}-1`,
    matchedIndicators: ["adf-0001"],
    matchedRules: ["rule-1"],
    evidenceQuality: "direct",
    observationLimitations: ["no_response_body_access"],
    ...over,
  };
}

export function makeDetection(over: Partial<Detection> = {}): Detection {
  return {
    detectionId: "d-1",
    timestamp: 1_700_000_000_500,
    firstEventTimestamp: 1_700_000_000_000,
    ruleId: "R-A1",
    ruleVersion: "1.0.0",
    ruleName: "Known infrastructure contact",
    category: "known_infrastructure",
    severity: "suspicious",
    confidence: "medium",
    confidenceRationale: `Exact hostname match for ${SUBJECT}.`,
    summary: `Contact with ${SUBJECT} while viewing ${TOP}`,
    significance: "Documented infrastructure.",
    evidence: [
      {
        eventIds: ["11111111-1111-4111-8111-111111111111"],
        observed: `Request to ${SUBJECT.toUpperCase()}/getAd from frame ${AD_FRAME} on ${TOP}. Later ${TOP}.`,
        kind: "observed",
      },
    ],
    eventIds: ["11111111-1111-4111-8111-111111111111"],
    matchedIndicatorIds: ["adf-0001"],
    missingVisibility: ["Response body not visible."],
    alternativeExplanations: ["Normal ad delivery."],
    recommendedActions: ["Review."],
    limitations: [],
    references: [{ title: "Report", url: "https://example.com/report" }],
    dedupKey: `R-A1:${SUBJECT}`,
    occurrenceCount: 1,
    subjectHostnames: [SUBJECT, TOP],
    tabId: 7,
    ...over,
  };
}

export const CAPS: SensorCapabilities = {
  browser: "firefox",
  browserVersion: "140.0",
  capabilities: ["request_metadata", "frame_ancestry"],
  notes: [],
};

export const SET_META: IndicatorSetMeta = {
  id: "test-set",
  name: "Test",
  version: "1.0.0",
  asOf: "2026-01-01",
  license: "CC0",
  synthetic: true,
  sources: [{ name: "x", url: "https://example.com", published: "2026-01-01" }],
};
