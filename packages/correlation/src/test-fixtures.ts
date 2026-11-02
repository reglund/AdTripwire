import type { Detection, NormalizedEvent, SensorCapabilities } from "@adtripwire/shared";

let seq = 0;
export const T0 = 1_762_000_000_000;

export function det(p: Partial<Detection> & { detectionId: string }): Detection {
  const ts = p.timestamp ?? T0 + seq++ * 1000;
  return {
    timestamp: ts,
    firstEventTimestamp: p.firstEventTimestamp ?? ts - 500,
    ruleId: "known_infra.surveillance_contact",
    ruleVersion: "1.0.0",
    ruleName: "Contact with documented surveillance infrastructure",
    category: "known_infrastructure",
    severity: "elevated",
    confidence: "high",
    confidenceRationale: "Exact hostname match against a documented indicator.",
    summary: "A request reached a documented host.",
    significance: "Public reporting ties this host to an ad-based delivery path.",
    evidence: [
      {
        eventIds: p.eventIds ?? [],
        observed: "Request to noas.synthetic-adfection.test observed.",
        kind: "observed",
      },
    ],
    eventIds: [],
    matchedIndicatorIds: [],
    missingVisibility: ["Response body not inspected."],
    alternativeExplanations: ["The host may also serve ordinary advertising."],
    recommendedActions: ["Preserve the evidence export."],
    limitations: [],
    references: [{ title: "Citizen Lab report", url: "https://citizenlab.ca/2026/10/adfection" }],
    dedupKey: `k-${p.detectionId}`,
    occurrenceCount: 1,
    subjectHostnames: ["noas.synthetic-adfection.test"],
    ...p,
  };
}

export function ev(p: Partial<NormalizedEvent> & { eventId: string }): NormalizedEvent {
  return {
    timestamp: T0,
    browser: "firefox",
    sensor: "webrequest",
    eventType: "request_completed",
    destination: {
      scheme: "https",
      hostname: "noas.synthetic-adfection.test",
      pathPattern: "/getAd",
      queryParamNames: [],
      redacted: false,
    },
    resourceType: "script",
    frameContext: {
      frameId: 3,
      parentFrameId: 0,
      ancestorHostnames: ["publisher.synthetic-site.test"],
      depth: 1,
      thirdParty: true,
    },
    requestStatus: "completed",
    statusCode: 200,
    matchedIndicators: [],
    matchedRules: [],
    evidenceQuality: "direct",
    observationLimitations: [],
    ...p,
  };
}

export const FIREFOX_CAPS: SensorCapabilities = {
  browser: "firefox",
  capabilities: [
    "request_metadata",
    "redirect_chain",
    "frame_ancestry",
    "third_party_flag",
    "url_classification",
    "response_headers",
    "response_body_inspection",
    "response_size",
  ],
  notes: [],
};

export const CHROMIUM_CAPS: SensorCapabilities = {
  browser: "chromium",
  capabilities: ["request_metadata", "redirect_chain", "response_headers", "response_size"],
  notes: [],
};
