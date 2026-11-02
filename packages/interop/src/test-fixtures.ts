import type {
  Detection,
  IndicatorRecord,
  IndicatorSet,
  NormalizedEvent,
  SensorCapabilities,
} from "@adtripwire/shared";

export const TOP_SITE = "private-reading.example.test";
export const INITIATOR = "initiator.private-blog.test";

function rec(
  over: Partial<IndicatorRecord> & Pick<IndicatorRecord, "id" | "indicator">,
): IndicatorRecord {
  return {
    indicatorType: "domain",
    source: "Synthetic Lab",
    sourceUrl: "https://report.example.test/adfection",
    campaign: "synthetic",
    classification: "surveillance",
    confidence: "high",
    firstReported: "2026-10-15",
    lastReviewed: "2026-11-02",
    enabled: true,
    role: "tracking",
    notes: "Synthetic tracking domain.\tWith a tab and a 'quote'.",
    ...over,
  };
}

/** Non-synthetic set using reserved .test names, so feed generators include it. */
export function makeSet(over: Partial<IndicatorSet["meta"]> = {}): IndicatorSet {
  return {
    meta: {
      id: "syn-set",
      name: "Synthetic set",
      version: "2026.11.02",
      asOf: "2026-11-02",
      license: "CC0-1.0",
      synthetic: false,
      sources: [
        { name: "Synthetic Lab", url: "https://report.example.test", published: "2026-10-15" },
      ],
      ...over,
    },
    indicators: [
      rec({ id: "s-1", indicator: "tracker-one.test" }),
      rec({
        id: "s-2",
        indicator: "c2.evil-host.test",
        indicatorType: "hostname",
        classification: "malicious",
        role: "c2",
        notes: "Synthetic C2.",
      }),
      rec({
        id: "s-3",
        indicator: "corp.contextual.test",
        indicatorType: "hostname",
        classification: "contextual",
        confidence: "low",
        role: "corporate",
      }),
      rec({
        id: "s-4",
        indicator: "shared-bucket.cdn.test",
        indicatorType: "hostname_path",
        pathPattern: "/Campaign_Path/",
        classification: "contextual",
        confidence: "medium",
        role: "creative-hosting",
      }),
      rec({
        id: "s-5",
        indicator: "rotated.staging.test",
        indicatorType: "hostname",
        validFrom: "2026-10-15",
        validTo: "2026-10-20",
        notes: "Expired staging host.",
      }),
      rec({ id: "s-6", indicator: "disabled.test", enabled: false }),
      rec({
        id: "s-7",
        indicator: "windowed.test",
        validFrom: "2026-10-15",
        validTo: "2027-01-31",
      }),
    ],
  };
}

export const CAPS: SensorCapabilities = {
  browser: "firefox",
  browserVersion: "140.0",
  capabilities: ["request_metadata", "frame_ancestry"],
  notes: [],
};

export function makeEvent(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    timestamp: 1_790_000_000_000,
    browser: "firefox",
    sensor: "webrequest",
    eventType: "request_completed",
    requestId: "42",
    tabId: 7,
    initiatorOrigin: `https://${INITIATOR}`,
    destination: {
      scheme: "https",
      hostname: "c2.evil-host.test",
      pathPattern: "/u/{id}/track",
      queryParamNames: ["idfa", "ipv4", "secretparam"],
      redacted: true,
    },
    resourceType: "xmlhttprequest",
    method: "get",
    frameContext: {
      frameId: 3,
      parentFrameId: 0,
      documentHostname: "adframe.cdn.test",
      topHostname: TOP_SITE,
      ancestorHostnames: ["adframe.cdn.test", TOP_SITE],
      depth: 2,
      thirdParty: true,
    },
    requestStatus: "completed",
    statusCode: 200,
    responseSizeIfObservable: 1234,
    matchedIndicators: ["s-2"],
    matchedRules: [],
    evidenceQuality: "direct",
    observationLimitations: ["no_response_body_access"],
    ...over,
  };
}

export function makeDetection(over: Partial<Detection> = {}): Detection {
  return {
    detectionId: "det-1",
    timestamp: 1_790_000_000_500,
    firstEventTimestamp: 1_790_000_000_000,
    ruleId: "known_infra.malicious_contact",
    ruleVersion: "1.0.0",
    ruleName: "Contact with documented malicious infrastructure",
    category: "known_infrastructure",
    severity: "high_priority",
    confidence: "medium",
    confidenceRationale: "Exact hostname match for c2.evil-host.test.",
    summary: "Observed traffic to documented infrastructure c2.evil-host.test",
    significance: "The host is documented as command-and-control infrastructure.",
    evidence: [
      {
        eventIds: ["11111111-1111-4111-8111-111111111111"],
        observed: "Request to c2.evil-host.test/u/{id}/track?token=abc123secret was observed.",
        kind: "observed",
      },
    ],
    eventIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
    matchedIndicatorIds: ["s-2", "s-4", "unknown-id"],
    missingVisibility: ["Response body not visible."],
    alternativeExplanations: ["The domain may have changed ownership."],
    recommendedActions: ["Review the timeline."],
    limitations: ["Browser-only visibility."],
    references: [{ title: "Synthetic report", url: "https://report.example.test/adfection" }],
    dedupKey: "known_infra:c2.evil-host.test",
    occurrenceCount: 3,
    subjectHostnames: ["c2.evil-host.test", "shared-bucket.cdn.test"],
    tabId: 7,
    ...over,
  };
}

export function makeEvents(): NormalizedEvent[] {
  return [
    makeEvent(),
    makeEvent({
      eventId: "22222222-2222-4222-8222-222222222222",
      timestamp: 1_790_000_000_400,
      destination: {
        scheme: "https",
        hostname: "shared-bucket.cdn.test",
        pathPattern: "/Campaign_Path/{hash}.js",
        queryParamNames: ["cb"],
        redacted: true,
      },
      eventType: "request_started",
      requestStatus: "started",
      matchedIndicators: ["s-4"],
    }),
  ];
}
