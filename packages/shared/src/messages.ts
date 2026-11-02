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
  /** Bundled and user-imported sets; imported ones carry `imported: true`. */
  indicatorSets: Array<IndicatorSetMeta & { imported?: boolean; enabled?: boolean }>;
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
  | { type: "list_rules" }
  // Phase 4: research integration
  | { type: "export_stix"; detectionIds?: string[]; includeIndicators: boolean }
  | { type: "export_siem"; detectionIds?: string[] }
  | { type: "import_indicator_set"; format: "adtripwire" | "stix"; text: string; enabled: boolean }
  | { type: "remove_indicator_set"; setId: string }
  | { type: "set_indicator_set_enabled"; setId: string; enabled: boolean }
  | { type: "set_detection_note"; detectionId: string; note: string }
  | { type: "get_timeline"; tabId?: number; since?: number; limit?: number }
  | { type: "export_handoff"; detectionIds?: string[]; profile: "default" | "strict" };

export interface DetectionFilter {
  categories?: string[];
  severities?: string[];
  confidences?: string[];
  since?: number;
  limit?: number;
}

export type UiResponse = { ok: true; data: unknown } | { ok: false; error: string };

/** A detection with its analyst note, as returned by get_detection / list_detections. */
export type DetectionWithNote = Detection & { note?: string };

/** Timeline entry: detections and their supporting events merged chronologically. */
export interface TimelineEntry {
  timestamp: number;
  kind: "detection" | "event";
  detectionId?: string;
  eventId?: string;
  severity?: Detection["severity"];
  ruleId?: string;
  summary: string;
  hostname?: string;
  tabId?: number;
  frameId?: number;
}

/** Result of a file export request: the UI saves `text` as `filename`. */
export interface ExportFile {
  filename: string;
  mediaType: string;
  text: string;
}

/** Result of an import: which set was added and what the validator said. */
export interface ImportResult {
  ok: boolean;
  setId?: string;
  indicatorCount?: number;
  errors: string[];
  warnings: string[];
}

export type DetectionListItem = Detection;
export type EventListItem = NormalizedEvent;
