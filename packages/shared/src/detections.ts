import type { Confidence } from "./indicators.js";

/**
 * Investigation priorities. These are NOT probabilities of compromise.
 */
export type Severity = "informational" | "suspicious" | "elevated" | "high_priority";

export type DetectionCategory =
  | "known_infrastructure" // A
  | "ad_delivery_behaviour" // B
  | "profiling" // C
  | "javascript_technique" // D
  | "temporal_correlation" // E
  | "repeated_exposure"; // F

export interface EvidenceItem {
  /** Event ids that directly support this item. */
  eventIds: string[];
  /** One-sentence, user-safe description of what was observed. Never includes secrets. */
  observed: string;
  /** Whether this is a direct observation or an inference drawn from several observations. */
  kind: "observed" | "inferred";
}

export interface DetectionReference {
  title: string;
  url: string;
}

/**
 * Norwegian (bokmål) counterparts of the Detection text fields, written by the rule next to the
 * English text with the same interpolated values. All fields are required inside `nb`: when it
 * is present it is complete, with arrays of the same length as their English twins. Exports,
 * STIX, SIEM and dedup keys keep using the English fields only.
 */
export interface DetectionTextNb {
  summary: string;
  significance: string;
  confidenceRationale: string;
  alternativeExplanations: string[];
  recommendedActions: string[];
  limitations: string[];
  missingVisibility: string[];
}

/** Bounds applied to stored `nb` text (strings in characters, arrays in items). */
export const DETECTION_NB_MAX_STRING = 2000;
export const DETECTION_NB_MAX_ITEMS = 40;

const NB_STRING_FIELDS = ["summary", "significance", "confidenceRationale"] as const;
const NB_LIST_FIELDS = [
  "alternativeExplanations",
  "recommendedActions",
  "limitations",
  "missingVisibility",
] as const;

/**
 * Validates an untrusted `nb` value (from storage or a snapshot). Returns a clean copy, or
 * `undefined` when anything is missing, mistyped or over its bound: a malformed `nb` is dropped,
 * never repaired, and never causes the detection itself to be rejected.
 */
export function sanitizeDetectionNb(value: unknown): DetectionTextNb | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  const str = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= DETECTION_NB_MAX_STRING;
  const out: Record<string, string | string[]> = {};
  for (const k of NB_STRING_FIELDS) {
    const v = o[k];
    if (!str(v)) return undefined;
    out[k] = v;
  }
  for (const k of NB_LIST_FIELDS) {
    const v = o[k];
    if (!Array.isArray(v) || v.length > DETECTION_NB_MAX_ITEMS || !v.every(str)) return undefined;
    out[k] = [...(v as string[])];
  }
  return out as unknown as DetectionTextNb;
}

/**
 * Returns the detection with a validated `nb`, or without the property when it is absent or
 * malformed.  Detections without `nb` are returned as is.
 */
export function withSanitizedNb<T extends { nb?: DetectionTextNb }>(d: T): T {
  if (!d || typeof d !== "object" || !("nb" in d)) return d;
  const clean = sanitizeDetectionNb(d.nb);
  const { nb: _drop, ...rest } = d;
  void _drop;
  return (clean ? { ...rest, nb: clean } : rest) as T;
}

export interface Detection {
  detectionId: string;
  /** Timestamp of the triggering (latest) event. */
  timestamp: number;
  /** First event timestamp in the supporting sequence. */
  firstEventTimestamp: number;
  ruleId: string;
  ruleVersion: string;
  ruleName: string;
  category: DetectionCategory;
  severity: Severity;
  confidence: Confidence;
  /** Why this confidence was assigned, in plain language. */
  confidenceRationale: string;
  /** Conservative, non-alarmist headline. */
  summary: string;
  /** Why it matters. */
  significance: string;
  evidence: EvidenceItem[];
  /** All contributing event ids, in chronological order. */
  eventIds: string[];
  matchedIndicatorIds: string[];
  /** What the sensor could NOT see that would be needed for stronger conclusions. */
  missingVisibility: string[];
  alternativeExplanations: string[];
  recommendedActions: string[];
  limitations: string[];
  references: DetectionReference[];
  /** Stable key used for de-duplication (same rule + same subject within a window). */
  dedupKey: string;
  /** Number of times this dedup key re-fired while suppressed. */
  occurrenceCount: number;
  /** Hostnames central to this detection (sanitized). Used for filtering/UI. */
  subjectHostnames: string[];
  tabId?: number;
  /** Norwegian text for display only; absent on detections stored before it existed. */
  nb?: DetectionTextNb;
}
