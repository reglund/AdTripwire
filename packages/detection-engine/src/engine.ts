import {
  fnv1a,
  withSanitizedNb,
  type Detection,
  type IndicatorMatch,
  type MonitoringSettings,
  type NormalizedEvent,
  type RuleDefinition,
  type SensorCapabilities,
  type SensorCapability,
} from "@adtripwire/shared";
import type { IndicatorMatcher } from "@adtripwire/indicators";
import { ALL_RULES } from "./rules/index.js";
import type { ExposureStore, Rule, RuleContext } from "./rules/types.js";
import { BoundedEventWindow, DEFAULT_MAX_WINDOW_EVENTS } from "./window.js";
import { MemoryExposureStore, type ExposureSnapshot } from "./exposure.js";

export interface DetectionEngineOptions {
  matcher: IndicatorMatcher;
  capabilities: SensorCapabilities;
  settings: MonitoringSettings;
  rules?: readonly Rule[];
  exposure?: ExposureStore;
  now?: () => number;
  /** Maximum events kept in the correlation window. Default 5000. */
  maxWindowEvents?: number;
  /** Maximum de-duplication entries kept. Default 5000. */
  maxDedupEntries?: number;
}

export interface IngestResult {
  /** Enriched copy of the input event (matchedIndicators, matchedRules, correlationId filled). */
  event: NormalizedEvent;
  /** New detections. */
  detections: Detection[];
  /** Previously emitted detections whose occurrenceCount was incremented by this event. */
  updated: Detection[];
}

export interface RuleStatus {
  definition: RuleDefinition;
  evaluable: boolean;
  missingCapabilities: SensorCapability[];
}

export interface EngineSnapshot {
  version: 1;
  rulesetVersion: string;
  events: NormalizedEvent[];
  dedup: Array<{ key: string; firstFired: number; detection: Detection }>;
  exposure?: ExposureSnapshot;
}

interface DedupEntry {
  firstFired: number;
  detection: Detection;
}

const MATCH_CACHE_MAX = 2000;

const SEVERITY_RANK: Record<Detection["severity"], number> = {
  informational: 0,
  suspicious: 1,
  elevated: 2,
  high_priority: 3,
};

function deriveCorrelationId(e: NormalizedEvent): string | undefined {
  if (e.correlationId !== undefined && e.correlationId !== "") return e.correlationId;
  if (e.tabId !== undefined && e.tabId >= 0) return `tab:${e.tabId}`;
  if (e.requestId !== undefined) return `req:${e.requestId}`;
  return undefined;
}

export class DetectionEngine {
  readonly #matcher: IndicatorMatcher;
  readonly #effectiveCaps: SensorCapability[];
  readonly #settings: MonitoringSettings;
  readonly #rules: readonly Rule[];
  readonly #exposure: ExposureStore;
  readonly #now: () => number;
  readonly #window: BoundedEventWindow;
  readonly #dedup = new Map<string, DedupEntry>();
  readonly #maxDedup: number;
  readonly #matchCache = new Map<string, IndicatorMatch[]>();
  #ruleErrors = 0;

  constructor(opts: DetectionEngineOptions) {
    this.#matcher = opts.matcher;
    this.#settings = opts.settings;
    this.#rules = opts.rules ?? ALL_RULES;
    this.#exposure = opts.exposure ?? new MemoryExposureStore();
    this.#now = opts.now ?? (() => Date.now());
    this.#maxDedup = Math.max(1, opts.maxDedupEntries ?? 5000);
    this.#window = new BoundedEventWindow(
      Math.max(1, opts.maxWindowEvents ?? DEFAULT_MAX_WINDOW_EVENTS),
      opts.settings.correlationWindowMs,
    );
    // A capability disabled in settings is effectively unavailable (response inspection, and
    // the opt-in page sensor).
    this.#effectiveCaps = opts.capabilities.capabilities.filter(
      (c) =>
        (c !== "response_body_inspection" || opts.settings.responseInspectionEnabled) &&
        (c !== "page_signals" || opts.settings.pageSensorEnabled === true),
    );
  }

  /** Read-only view of the correlation window (for diagnostics and tests). */
  get window(): BoundedEventWindow {
    return this.#window;
  }

  get dedupSize(): number {
    return this.#dedup.size;
  }

  /** Number of rule evaluations that threw (rules are isolated; one failing rule never blocks others). */
  get ruleErrors(): number {
    return this.#ruleErrors;
  }

  get exposure(): ExposureStore {
    return this.#exposure;
  }

  get rulesetVersion(): string {
    const ids = this.#rules.map((r) => `${r.definition.id}@${r.definition.version}`).sort();
    return `${ids.length}r-${fnv1a(ids.join(","))}`;
  }

  listRules(): RuleStatus[] {
    return this.#rules.map((r) => {
      const missing = this.#missingFor(r);
      return {
        definition: r.definition,
        evaluable: missing.length === 0,
        missingCapabilities: missing,
      };
    });
  }

  #missingFor(r: Rule): SensorCapability[] {
    const caps = this.#effectiveCaps;
    const missing = r.definition.requiredCapabilities.filter((c) => !caps.includes(c));
    const anyOf = r.anyOfCapabilities ?? [];
    if (anyOf.length > 0 && !anyOf.some((c) => caps.includes(c))) {
      for (const c of anyOf) if (!missing.includes(c)) missing.push(c);
    }
    return missing;
  }

  /**
   * Indicator matches at evaluation time `now`. Validity windows are whole UTC days, so the
   * cache key includes the UTC day and a cached validity can never be stale.
   */
  #indicatorMatches(e: NormalizedEvent, now: number): IndicatorMatch[] {
    const key = `${e.destination.hostname}|${e.destination.pathPattern}|${Math.floor(now / 86_400_000)}`;
    let m = this.#matchCache.get(key);
    if (m === undefined) {
      m = this.#matcher.match(e.destination.hostname, e.destination.pathPattern, now);
      if (this.#matchCache.size >= MATCH_CACHE_MAX) this.#matchCache.clear();
      this.#matchCache.set(key, m);
    }
    return m;
  }

  ingest(input: NormalizedEvent): IngestResult {
    const now = this.#now();
    const reference = Math.max(now, input.timestamp);
    this.pruneWindow(reference);

    const correlationId = deriveCorrelationId(input);
    const matches = this.#indicatorMatches(input, now);
    const event: NormalizedEvent = {
      ...input,
      destination: {
        ...input.destination,
        queryParamNames: [...input.destination.queryParamNames],
      },
      frameContext: {
        ...input.frameContext,
        ancestorHostnames: [...input.frameContext.ancestorHostnames],
        ...(input.frameContext.ancestorFrameIds
          ? { ancestorFrameIds: [...input.frameContext.ancestorFrameIds] }
          : {}),
        ...(input.frameContext.urlClassification
          ? {
              urlClassification: {
                firstParty: [...input.frameContext.urlClassification.firstParty],
                thirdParty: [...input.frameContext.urlClassification.thirdParty],
              },
            }
          : {}),
      },
      observationLimitations: [...input.observationLimitations],
      ...(input.pageSignal ? { pageSignal: { ...input.pageSignal } } : {}),
      ...(input.responseInspection
        ? {
            responseInspection: {
              ...input.responseInspection,
              markers: [...input.responseInspection.markers],
              ...(input.responseInspection.stats
                ? { stats: { ...input.responseInspection.stats } }
                : {}),
            },
          }
        : {}),
      matchedIndicators: matches.map((m) => m.indicator.id),
      matchedRules: [],
      ...(correlationId !== undefined ? { correlationId } : {}),
    };

    const ctx: RuleContext = {
      matcher: this.#matcher,
      capabilities: this.#effectiveCaps,
      settings: this.#settings,
      now,
      window: this.#window,
      exposure: this.#exposure,
      indicatorMatches: (e) => this.#indicatorMatches(e, now),
    };

    const detections: Detection[] = [];
    const updated: Detection[] = [];
    const firedRules: string[] = [];

    for (const rule of this.#rules) {
      if (this.#missingFor(rule).length > 0) continue;
      let produced: Detection[];
      try {
        produced = rule.evaluate(event, ctx);
      } catch {
        this.#ruleErrors++;
        continue;
      }
      if (produced.length > 0 && !firedRules.includes(rule.definition.id))
        firedRules.push(rule.definition.id);
      for (const d of produced) {
        const existing = this.#dedup.get(d.dedupKey);
        if (
          existing &&
          d.timestamp - existing.firstFired <= this.#settings.correlationWindowMs &&
          d.timestamp >= existing.firstFired
        ) {
          const prev = existing.detection;
          if (SEVERITY_RANK[d.severity] > SEVERITY_RANK[prev.severity]) {
            // Escalation: later evidence for the same subject (e.g. the inspected body arriving
            // after the completed event) upgrades the stored detection in place.
            const eventIds = [...prev.eventIds];
            for (const id of d.eventIds) if (!eventIds.includes(id)) eventIds.push(id);
            existing.detection = {
              ...d,
              detectionId: prev.detectionId,
              firstEventTimestamp: Math.min(prev.firstEventTimestamp, d.firstEventTimestamp),
              occurrenceCount: prev.occurrenceCount + 1,
              timestamp: Math.max(prev.timestamp, d.timestamp),
              eventIds,
            };
          } else {
            existing.detection = {
              ...prev,
              occurrenceCount: prev.occurrenceCount + 1,
              timestamp: Math.max(prev.timestamp, d.timestamp),
            };
          }
          updated.push(existing.detection);
        } else {
          this.#dedup.delete(d.dedupKey);
          this.#dedup.set(d.dedupKey, { firstFired: d.timestamp, detection: d });
          while (this.#dedup.size > this.#maxDedup) {
            const oldest = this.#dedup.keys().next().value;
            if (oldest === undefined) break;
            this.#dedup.delete(oldest);
          }
          detections.push(d);
        }
      }
    }

    event.matchedRules = firedRules;
    this.#window.add(event);
    return { event, detections, updated };
  }

  /** Drop window events and dedup entries older than the correlation window. */
  pruneWindow(now?: number): void {
    const reference = now ?? this.#now();
    this.#window.prune(reference);
    const cutoff = reference - this.#settings.correlationWindowMs;
    for (const [k, v] of this.#dedup) if (v.firstFired < cutoff) this.#dedup.delete(k);
  }

  snapshot(): EngineSnapshot {
    const exp = this.#exposure as Partial<{ toJSON: () => ExposureSnapshot }>;
    return {
      version: 1,
      rulesetVersion: this.rulesetVersion,
      events: this.#window.recent().map((e) => structuredCloneSafe(e)),
      dedup: [...this.#dedup].map(([key, v]) => ({
        key,
        firstFired: v.firstFired,
        detection: structuredCloneSafe(v.detection),
      })),
      ...(typeof exp.toJSON === "function" ? { exposure: exp.toJSON() } : {}),
    };
  }

  static restore(snapshot: EngineSnapshot, opts: DetectionEngineOptions): DetectionEngine {
    const exposure =
      opts.exposure ??
      (snapshot.exposure ? MemoryExposureStore.fromJSON(snapshot.exposure) : undefined);
    const engine = new DetectionEngine({ ...opts, ...(exposure ? { exposure } : {}) });
    // A snapshot from a different ruleset is discarded: dedup keys and rule ids may not match.
    if (snapshot && snapshot.version === 1 && snapshot.rulesetVersion === engine.rulesetVersion) {
      for (const e of Array.isArray(snapshot.events) ? snapshot.events : []) {
        if (isEventLike(e)) engine.#window.add(e);
      }
      for (const d of Array.isArray(snapshot.dedup) ? snapshot.dedup : []) {
        if (
          d &&
          typeof d.key === "string" &&
          typeof d.firstFired === "number" &&
          isDetectionLike(d.detection)
        ) {
          engine.#dedup.set(d.key, {
            firstFired: d.firstFired,
            detection: withSanitizedNb(d.detection),
          });
        }
      }
    }
    engine.pruneWindow();
    return engine;
  }
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const SEVERITIES = new Set(["informational", "suspicious", "elevated", "high_priority"]);

function isDetectionLike(d: unknown): d is Detection {
  if (!d || typeof d !== "object") return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.detectionId === "string" &&
    typeof o.ruleId === "string" &&
    typeof o.dedupKey === "string" &&
    typeof o.timestamp === "number" &&
    typeof o.occurrenceCount === "number" &&
    SEVERITIES.has(o.severity as string) &&
    Array.isArray(o.eventIds) &&
    o.eventIds.every((x) => typeof x === "string") &&
    Array.isArray(o.subjectHostnames)
  );
}

function isEventLike(e: unknown): e is NormalizedEvent {
  if (typeof e !== "object" || e === null) return false;
  const x = e as Partial<NormalizedEvent>;
  return (
    typeof x.eventId === "string" &&
    typeof x.timestamp === "number" &&
    typeof x.eventType === "string" &&
    typeof x.destination === "object" &&
    x.destination !== null &&
    typeof x.destination.hostname === "string" &&
    Array.isArray(x.destination.queryParamNames) &&
    typeof x.frameContext === "object" &&
    x.frameContext !== null &&
    Array.isArray(x.observationLimitations)
  );
}
