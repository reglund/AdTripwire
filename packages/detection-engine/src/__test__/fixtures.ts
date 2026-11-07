/**
 * Test helpers (no vitest import; compiled by tsc -b as part of src).
 * Synthetic indicators are inlined from tests/fixtures/indicators/synthetic.json because files
 * outside src/ cannot be imported here under rootDir.
 */
import type {
  Detection,
  DetectionTextNb,
  EventType,
  IndicatorRecord,
  IndicatorSet,
  MonitoringSettings,
  NormalizedEvent,
  ObservationLimitation,
  PageSignal,
  ResourceType,
  RuleDefinitionNb,
  ResponseInspection,
  SensorCapability,
  UrlClassificationFlag,
} from "@adtripwire/shared";
import { IndicatorMatcher } from "@adtripwire/indicators";
import { DetectionEngine, type DetectionEngineOptions, type IngestResult } from "../engine.js";
import type { Rule } from "../rules/types.js";
import { ALL_RULES } from "../rules/index.js";

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

/** Every capability except the opt-in page sensor (see PAGE_CAPS). */
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

export const PAGE_CAPS: SensorCapability[] = [...ALL_CAPS, "page_signals"];

export const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);
export const WINDOW_MS = 5 * 60 * 1000;

export function settings(over: Partial<MonitoringSettings> = {}): MonitoringSettings {
  return {
    enabled: true,
    pageSensorEnabled: false,
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
  /** Frame id (default: depth). */
  frameId?: number;
  /** Parent frame id (default: frameId - 1). */
  parentFrameId?: number;
  /**
   * Ancestor frame ids. Default is Firefox-like: [] at depth 0, else [depth-1, ..., 0].
   * `null` omits the field (Chromium-like sensor without frame ancestry).
   */
  ancestors?: number[] | null;
}

const STATUS: Record<EventType, NormalizedEvent["requestStatus"]> = {
  page_signal: "unknown",
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
  const frameId = o.frameId ?? depth;
  const ancestors =
    o.ancestors === null
      ? undefined
      : (o.ancestors ?? Array.from({ length: depth }, (_, i) => depth - 1 - i));
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
      frameId,
      parentFrameId: o.parentFrameId ?? frameId - 1,
      ancestorHostnames: [],
      ...(ancestors !== undefined ? { ancestorFrameIds: ancestors } : {}),
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
  if (eventType === "page_signal") e.sensor = "page";
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

/**
 * Norwegian verdict words (phase 11, D3). Letter-aware boundaries: JS `\b` does not treat
 * æ, ø, å as word characters, and "sikker" must not hit "sikkerhet" or "usikker".
 */
const FORBIDDEN_NB = new RegExp(
  "(?<!\\p{L})(?:infiser\\p{L}*|smitt\\p{L}*|kompromitter\\p{L}*|spioner\\p{L}*|trygg\\p{L}*|trygt|sikker|sikkert|ren|rent|rene|hacket|hacka|overvåket|angrepet|rammet|berørt|ufarlig|harmløs|uskadelig)(?!\\p{L})" +
    "|overvåker deg|overvåkes av|uten fare|ingen grunn til bekymring",
  "iu",
);

/** Throws when Norwegian text contains a verdict word. */
export function assertConservativeNb(label: string, text: string): void {
  const m = FORBIDDEN_NB.exec(text);
  if (m) throw new Error(`Forbidden Norwegian wording «${m[0]}» in ${label}: ${text}`);
}

function nbTexts(nb: DetectionTextNb): string[] {
  return [
    nb.summary,
    nb.significance,
    nb.confidenceRationale,
    ...nb.alternativeExplanations,
    ...nb.recommendedActions,
    ...nb.limitations,
    ...nb.missingVisibility,
  ];
}

export function ruleDefinitionNbTexts(nb: RuleDefinitionNb): string[] {
  return [
    nb.name,
    nb.description,
    nb.confidenceBasis,
    ...nb.limitations,
    ...nb.falsePositiveConsiderations,
  ];
}

/**
 * Rules whose Norwegian text is still to be written. Empty: every shipped rule has `nb`. A new
 * rule must either carry `nb` or be listed here explicitly.
 */
export const PENDING_NB_RULE_IDS: readonly string[] = [];

/** Rule ids that must emit complete Norwegian text: every shipped rule not in the pending list. */
export function nbRequiredRuleIds(): string[] {
  return ALL_RULES.map((r) => r.definition.id).filter((id) => !PENDING_NB_RULE_IDS.includes(id));
}

const HOSTNAME_RE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:test|invalid|com|net|org|io)\b/gi;
const digitRuns = (t: string): string => (t.match(/\d+/g) ?? []).sort().join(",");
const hostnames = (t: string): string[] => t.match(HOSTNAME_RE) ?? [];

/**
 * Every English text field has a Norwegian counterpart: same array lengths, non-empty strings,
 * and the same hostnames and numbers in each pair.
 */
export function assertNbMirrorsEnglish(d: Detection): void {
  const nb = d.nb;
  if (!nb) throw new Error(`${d.ruleId} detection has no nb text`);
  const pairs: Array<[string, string, string]> = [];
  const one = (name: string, en: string, no: string): void => {
    pairs.push([name, en, no]);
  };
  const list = (name: string, en: readonly string[], no: readonly string[]): void => {
    if (en.length !== no.length)
      throw new Error(`${d.ruleId} nb.${name} has ${no.length} items, English has ${en.length}`);
    en.forEach((x, i) => one(`${name}[${i}]`, x, no[i]!));
  };
  one("summary", d.summary, nb.summary);
  one("significance", d.significance, nb.significance);
  one("confidenceRationale", d.confidenceRationale, nb.confidenceRationale);
  list("alternativeExplanations", d.alternativeExplanations, nb.alternativeExplanations);
  list("recommendedActions", d.recommendedActions, nb.recommendedActions);
  list("limitations", d.limitations, nb.limitations);
  list("missingVisibility", d.missingVisibility, nb.missingVisibility);
  for (const [name, en, no] of pairs) {
    if (no.trim().length === 0) throw new Error(`${d.ruleId} nb.${name} is empty`);
    if (no === en) throw new Error(`${d.ruleId} nb.${name} is identical to the English text`);
    for (const h of hostnames(en))
      if (!no.includes(h)) throw new Error(`${d.ruleId} nb.${name} lacks hostname ${h}`);
    if (digitRuns(en) !== digitRuns(no))
      throw new Error(`${d.ruleId} nb.${name} numbers differ from English: ${en} | ${no}`);
  }
}

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
  if (d.nb) for (const t of nbTexts(d.nb)) assertConservativeNb(`${d.ruleId} nb`, t);
  if (nbRequiredRuleIds().includes(d.ruleId)) assertNbMirrorsEnglish(d);
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
      /** Enable the opt-in page sensor (capability + setting). */
      pageSensor?: boolean;
    } = {},
  ) {
    const { caps, windowMs, pageSensor, ...rest } = over;
    this.engine = new DetectionEngine({
      matcher: new IndicatorMatcher([SYNTHETIC_SET]),
      capabilities: {
        browser: "firefox",
        capabilities: caps ?? (pageSensor ? PAGE_CAPS : ALL_CAPS),
        notes: [],
      },
      settings: settings({
        ...(windowMs !== undefined ? { correlationWindowMs: windowMs } : {}),
        ...(pageSensor ? { pageSensorEnabled: true } : {}),
      }),
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

/** A page-sensor signal in the given frame (Firefox-like lineage by default). */
export function sig(
  kind: PageSignal["kind"],
  o: Partial<EvOpts> & { target?: string; crossOrigin?: boolean; msSinceLoad?: number } = {},
): NormalizedEvent {
  const { target, crossOrigin, msSinceLoad, ...rest } = o;
  const e = ev({
    host: "ad.synthetic-exchange.test",
    type: "other",
    depth: 1,
    ...rest,
    eventType: "page_signal",
  });
  delete e.requestId;
  delete e.resourceType;
  delete e.method;
  e.pageSignal = {
    kind,
    ...(target !== undefined ? { targetHostname: target } : {}),
    ...(crossOrigin !== undefined ? { crossOrigin } : {}),
    ...(msSinceLoad !== undefined ? { msSinceLoad } : {}),
  };
  return e;
}
