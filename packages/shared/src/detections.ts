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
}
