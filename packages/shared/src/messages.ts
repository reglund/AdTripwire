/**
 * Extension-internal messaging protocol between privileged UI pages and the
 * background sensor. Content scripts are NOT part of Phase 1; if introduced,
 * they get a separate, narrower protocol with strict validation.
 */
import type { Detection } from "./detections.js";
import type { NormalizedEvent } from "./events.js";
import type { Settings } from "./settings.js";
import type { SensorCapabilities } from "./capabilities.js";
import type { IndicatorSetMeta } from "./indicators.js";

export interface MonitoringStatus {
  monitoring: boolean;
  hostPermissionGranted: boolean;
  capabilities: SensorCapabilities;
  counts: {
    knownIocObservations: number;
    suspiciousPatterns: number;
    highPriority: number;
    detectionsTotal: number;
    eventsStored: number;
  };
  lastSignificant?: Pick<Detection, "detectionId" | "timestamp" | "severity" | "summary">;
  /** Aggregate, privacy-safe runtime metrics (no URLs). */
  metrics?: {
    eventsObserved: number;
    eventsIngested: number;
    inspections: number;
    inspectedBytes: number;
    /** Mean milliseconds spent inside StreamFilter callbacks per inspected response. */
    passThroughMsMean: number;
    /** Mean milliseconds of deferred analysis per inspected response. */
    analysisMsMean: number;
    /** Mean milliseconds per engine ingest. */
    ingestMsMean: number;
    inspectionsSkippedForBudget: number;
    since: number;
  };
  indicatorSets: IndicatorSetMeta[];
  rulesetVersion: string;
  productVersion: string;
}

export type UiRequest =
  | { type: "get_status" }
  | { type: "list_detections"; filter?: DetectionFilter }
  | { type: "get_detection"; detectionId: string }
  | { type: "get_events"; eventIds: string[] }
  | { type: "get_settings" }
  | {
      type: "update_settings";
      patch: Partial<Settings["monitoring"]> & Partial<Settings["retention"]>;
    }
  | { type: "export_evidence"; profile: "default" | "strict"; detectionIds?: string[] }
  | { type: "delete_all_data" }
  | { type: "request_host_permission" }
  | { type: "list_rules" };

export interface DetectionFilter {
  categories?: string[];
  severities?: string[];
  confidences?: string[];
  since?: number;
  limit?: number;
}

export type UiResponse = { ok: true; data: unknown } | { ok: false; error: string };

export type DetectionListItem = Detection;
export type EventListItem = NormalizedEvent;
