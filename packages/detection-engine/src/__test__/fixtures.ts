/**
 * Test helpers (no vitest import; compiled by tsc -b as part of src).
 * Synthetic indicators are inlined from tests/fixtures/indicators/synthetic.json because files
 * outside src/ cannot be imported here under rootDir.
 */
import type {
  Detection,
  EventType,
  IndicatorRecord,
  IndicatorSet,
  MonitoringSettings,
  NormalizedEvent,
  ObservationLimitation,
  ResourceType,
  ResponseInspection,
  SensorCapability,
  UrlClassificationFlag,
} from "@adtripwire/shared";
import { IndicatorMatcher } from "@adtripwire/indicators";
import { DetectionEngine, type DetectionEngineOptions, type IngestResult } from "../engine.js";
import type { Rule } from "../rules/types.js";

const rec = (
  id: string,
  indicator: string,
  classification: IndicatorRecord["classification"],
  role: string,
  extra: Partial<IndicatorRecord> = {},
): IndicatorRecord => ({
  id,
  indicator,
  indicatorType: "hostname",
  source: "AdTripwire fixtures",
  sourceUrl: "https://github.com/reglund/AdTripwire",
  campaign: "synthetic",
  classification,
  confidence: "high",
  firstReported: "2026-11-02",
  lastReviewed: "2026-11-02",
  enabled: true,
  role,
  ...extra,
});

export const SYNTHETIC_SET: IndicatorSet = {
  meta: {
    id: "synthetic-test",
    name: "AdTripwire synthetic test indicators",
    version: "1.0.0",
    asOf: "2026-11-02",
    license: "Apache-2.0",
    synthetic: true,
    sources: [
      {
        name: "AdTripwire test fixtures",
        url: "https://github.com/reglund/AdTripwire",
        published: "2026-11-02",
      },
    ],
  },
  indicators: [
    rec("syn-0001", "c2.synthetic-adfection.test", "malicious", "c2"),
    rec("syn-0002", "validator.synthetic-adfection.test", "malicious", "validator"),
    rec("syn-0003", "noas.synthetic-adfection.test", "surveillance", "noas"),
    rec("syn-0004", "synthetic-dsp.test", "surveillance", "operator-infrastructure", {
      indicatorType: "domain",
      confidence: "medium",
    }),
    rec("syn-0005", "sync.synthetic-tracking.test", "surveillance", "tracking"),
    rec("syn-0006", "corp.synthetic-vendor.test", "contextual", "corporate", {
      confidence: "medium",
    }),
    rec("syn-0007", "disabled.synthetic-adfection.test", "malicious", "c2", { enabled: false }),
  ],
};

export const ALL_CAPS: SensorCapability[] = [
  "request_metadata",
  "redirect_chain",
  "frame_ancestry",
  "third_party_flag",
  "url_classification",
  "response_headers",
  "response_body_inspection",
  "response_size",
];

export const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);
export const WINDOW_MS = 5 * 60 * 1000;

export function settings(over: Partial<MonitoringSettings> = {}): MonitoringSettings {
  return {
    enabled: true,
    responseInspectionEnabled: true,
    responseInspectionMaxBytes: 512 * 1024,
    excludeIncognito: true,
    correlationWindowMs: WINDOW_MS,
    ...over,
  };
}

let seq = 0;

export interface EvOpts {
  host: string;
  path?: string;
  params?: string[];
  type?: ResourceType;
  eventType?: EventType;
  t?: number;
  tab?: number;
  rid?: string;
  thirdParty?: boolean;
  depth?: number;
  topHost?: string;
  tp?: UrlClassificationFlag[];
  fp?: UrlClassificationFlag[];
  size?: number;
  inspection?: Partial<ResponseInspection>;
  redirectHost?: string;
  limitations?: ObservationLimitation[];
  correlationId?: string;
}

const STATUS: Record<EventType, NormalizedEvent["requestStatus"]> = {
  request_started: "started",
  request_redirected: "redirected",
  request_headers_received: "headers_received",
  request_completed: "completed",
  request_error: "error",
  response_inspected: "completed",
  frame_navigated: "unknown",
};

export function ev(o: EvOpts): NormalizedEvent {
  seq++;
  const eventType = o.eventType ?? "request_started";
  const depth = o.depth ?? 0;
  const e: NormalizedEvent = {
    eventId: `evt-${seq}`,
    timestamp: o.t ?? T0,
    browser: "firefox",
    sensor: eventType === "response_inspected" ? "response-filter" : "synthetic",
    eventType,
    requestId: o.rid ?? `r${seq}`,
    tabId: o.tab ?? 1,
    destination: {
      scheme: "https",
      hostname: o.host,
      pathPattern: o.path ?? "/",
      queryParamNames: [...(o.params ?? [])].map((p) => p.toLowerCase()).sort(),
      redacted: false,
    },
    resourceType: o.type ?? "script",
    method: "GET",
    frameContext: {
      frameId: depth,
      parentFrameId: depth - 1,
      ancestorHostnames: [],
      depth,
      thirdParty: o.thirdParty ?? true,
      topHostname: o.topHost ?? "news.synthetic-publisher.test",
      ...(o.tp || o.fp
        ? { urlClassification: { thirdParty: o.tp ?? [], firstParty: o.fp ?? [] } }
        : {}),
    },
    requestStatus: STATUS[eventType],
    matchedIndicators: [],
    matchedRules: [],
    evidenceQuality: "direct",
    observationLimitations: o.limitations ?? [],
    ...(o.size !== undefined ? { responseSizeIfObservable: o.size } : {}),
    ...(o.redirectHost !== undefined ? { redirectHostname: o.redirectHost } : {}),
    ...(o.correlationId !== undefined ? { correlationId: o.correlationId } : {}),
  };
  if (eventType === "response_inspected") {
    e.responseInspection = {
      observedBytes: 4096,
      truncated: false,
      textDecodable: true,
      markers: [],
      contentType: "application/javascript",
      ...o.inspection,
    };
  }
  return e;
}

/** Same request, next lifecycle stage. */
export function stage(
  base: NormalizedEvent,
  eventType: EventType,
  over: Partial<EvOpts> = {},
): NormalizedEvent {
  return ev({
    host: base.destination.hostname,
    path: base.destination.pathPattern,
    params: base.destination.queryParamNames,
    ...(base.resourceType ? { type: base.resourceType } : {}),
    t: base.timestamp + 50,
    ...(base.tabId !== undefined ? { tab: base.tabId } : {}),
    ...(base.requestId !== undefined ? { rid: base.requestId } : {}),
    depth: base.frameContext.depth,
    thirdParty: base.frameContext.thirdParty ?? true,
    eventType,
    ...over,
  });
}

const FORBIDDEN = /infected|spied|\bis safe\b|\bare safe\b|compromised/i;

export function assertConservativeLanguage(d: Detection): void {
  for (const field of [d.summary, d.significance, d.confidenceRationale]) {
    if (FORBIDDEN.test(field)) throw new Error(`Forbidden wording in ${d.ruleId}: ${field}`);
  }
  for (const k of [
    "alternativeExplanations",
    "recommendedActions",
    "limitations",
    "missingVisibility",
    "references",
    "evidence",
  ] as const) {
    if (d[k].length === 0) throw new Error(`${d.ruleId} has empty ${k}`);
  }
  if (!d.summary || !d.significance || !d.confidenceRationale)
    throw new Error(`${d.ruleId} missing text`);
}

/** Engine wrapper with a controllable clock and a language guard on every detection. */
export class Harness {
  clock = T0;
  readonly engine: DetectionEngine;
  readonly all: Detection[] = [];
  constructor(
    over: Partial<DetectionEngineOptions> & {
      caps?: SensorCapability[];
      windowMs?: number;
      rules?: readonly Rule[];
    } = {},
  ) {
    const { caps, windowMs, ...rest } = over;
    this.engine = new DetectionEngine({
      matcher: new IndicatorMatcher([SYNTHETIC_SET]),
      capabilities: { browser: "firefox", capabilities: caps ?? ALL_CAPS, notes: [] },
      settings: settings(windowMs !== undefined ? { correlationWindowMs: windowMs } : {}),
      now: () => this.clock,
      ...rest,
    });
  }
  ingest(e: NormalizedEvent): IngestResult {
    this.clock = Math.max(this.clock, e.timestamp);
    const r = this.engine.ingest(e);
    for (const d of [...r.detections, ...r.updated]) assertConservativeLanguage(d);
    this.all.push(...r.detections);
    return r;
  }
  ingestAll(events: NormalizedEvent[]): Detection[] {
    return events.flatMap((e) => this.ingest(e).detections);
  }
}

export const ids = (ds: Detection[]): string[] => ds.map((d) => d.ruleId).sort();
