/** Mapping between the Detections filter controls and the `DetectionFilter` request payload. */
import type { Confidence, DetectionFilter, Severity } from "@adtripwire/shared";
import { CONFIDENCE_ORDER, SEVERITY_ORDER } from "./format.js";

export type SinceKey = "all" | "1h" | "24h" | "7d" | "30d";

export const SINCE_OPTIONS: ReadonlyArray<{ key: SinceKey; label: string; ms: number | null }> = [
  { key: "all", label: "Any time", ms: null },
  { key: "1h", label: "Last hour", ms: 60 * 60_000 },
  { key: "24h", label: "Last 24 hours", ms: 24 * 60 * 60_000 },
  { key: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60_000 },
  { key: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60_000 },
];

export interface FilterState {
  /** Selected categories; empty means all. */
  categories: string[];
  /** Minimum severity ("at least"); "any" means no restriction. */
  minSeverity: "any" | Severity;
  /** Minimum confidence ("at least"); "any" means no restriction. */
  minConfidence: "any" | Confidence;
  since: SinceKey;
}

export const DEFAULT_LIST_LIMIT = 500;

export function defaultFilterState(): FilterState {
  return { categories: [], minSeverity: "any", minConfidence: "any", since: "all" };
}

/** All levels at or above `min` in an ascending ordering. */
export function atLeast<T extends string>(order: readonly T[], min: T): T[] {
  const i = order.indexOf(min);
  return i < 0 ? [...order] : order.slice(i);
}

/** Builds the request filter. Unset controls are omitted entirely (exactOptionalPropertyTypes). */
export function toDetectionFilter(
  state: FilterState,
  now: number = Date.now(),
  limit: number = DEFAULT_LIST_LIMIT,
): DetectionFilter {
  const filter: DetectionFilter = { limit };
  if (state.categories.length > 0) filter.categories = [...state.categories];
  if (state.minSeverity !== "any") filter.severities = atLeast(SEVERITY_ORDER, state.minSeverity);
  if (state.minConfidence !== "any") {
    filter.confidences = atLeast(CONFIDENCE_ORDER, state.minConfidence);
  }
  const since = SINCE_OPTIONS.find((o) => o.key === state.since);
  if (since && since.ms !== null) filter.since = now - since.ms;
  return filter;
}
