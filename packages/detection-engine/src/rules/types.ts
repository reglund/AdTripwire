import type {
  Detection,
  IndicatorMatch,
  MonitoringSettings,
  NormalizedEvent,
  RuleDefinition,
  SensorCapability,
} from "@adtripwire/shared";
import type { IndicatorMatcher } from "@adtripwire/indicators";

/** Recent events inside the correlation window, in insertion (approximately chronological) order. */
export interface EventWindow {
  recent(): readonly NormalizedEvent[];
  byRequestId(id: string): NormalizedEvent[];
  byCorrelationId(id: string): NormalizedEvent[];
  byTab(tabId: number): NormalizedEvent[];
}

/** Persisted per-hostname record of distinct contact days (category F). */
export interface ExposureStore {
  /** Record a contact on `dayKey` (YYYY-MM-DD, UTC). Returns true if this day was not yet recorded for the host. */
  record(hostname: string, dayKey: string): boolean;
  distinctDays(hostname: string): number;
}

export interface RuleContext {
  matcher: IndicatorMatcher;
  capabilities: SensorCapability[];
  settings: MonitoringSettings;
  now: number;
  window: EventWindow;
  exposure: ExposureStore;
  /** Cached indicator matches for an event's destination. */
  indicatorMatches(event: NormalizedEvent): IndicatorMatch[];
}

export interface Rule {
  definition: RuleDefinition;
  /**
   * Optional "at least one of" capability requirement, in addition to
   * `definition.requiredCapabilities` (which must ALL be present).
   */
  anyOfCapabilities?: SensorCapability[];
  evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[];
}
