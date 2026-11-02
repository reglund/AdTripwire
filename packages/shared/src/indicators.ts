/**
 * Normalized indicator (IOC) model, independent of upstream providers.
 */

export type IndicatorType = "hostname" | "domain" | "url_path" | "hostname_path";

/**
 * - malicious: infrastructure documented as spyware C2, validator, or exploit delivery.
 * - surveillance: ad-delivery / tracking infrastructure operated by the documented actor
 *   (exposure is common; contact alone is not evidence of targeting).
 * - contextual: corporate / attribution-related hosts; a lead for an analyst, not a finding.
 */
export type IndicatorClassification = "malicious" | "surveillance" | "contextual";

export type Confidence = "low" | "medium" | "high";

export interface IndicatorRecord {
  /** Stable id, e.g. "adf-0042". */
  id: string;
  /** The indicator value: a lower-cased hostname, or for url_path a path prefix like "/getAd". */
  indicator: string;
  indicatorType: IndicatorType;
  /**
   * For "domain": matches the apex and ALL subdomains (boundary-safe).
   * For "hostname": exact hostname match only.
   * For "hostname_path": exact hostname AND path pattern prefix match (pathPattern required).
   * For "url_path": path pattern match on any host (use sparingly; pathPattern required).
   */
  pathPattern?: string;
  source: string;
  sourceUrl: string;
  campaign: string;
  classification: IndicatorClassification;
  confidence: Confidence;
  /** ISO date (YYYY-MM-DD). */
  firstReported: string;
  lastReviewed: string;
  enabled: boolean;
  notes?: string;
  /** Free-form role tag from the source (e.g. "c2", "validator", "noas", "tracking"). */
  role?: string;
}

export interface IndicatorSetMeta {
  /** e.g. "adfection-2026" */
  id: string;
  name: string;
  version: string;
  /** ISO date of curation. */
  asOf: string;
  license: string;
  /** True for synthetic test sets; such sets must never ship enabled in production builds. */
  synthetic: boolean;
  sources: Array<{ name: string; url: string; published: string }>;
  description?: string;
}

export interface IndicatorSet {
  meta: IndicatorSetMeta;
  indicators: IndicatorRecord[];
}

export interface IndicatorMatch {
  indicator: IndicatorRecord;
  setId: string;
  /** How the match was made. */
  matchKind: "exact_hostname" | "domain_suffix" | "hostname_path" | "url_path";
}
