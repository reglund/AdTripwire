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
import type {
  AssistLanguage,
  DetectionCluster,
  SuggestedActions,
  TimelineSummary,
} from "./correlation.js";

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
  lastSignificant?: Pick<Detection, "detectionId" | "timestamp" | "severity" | "summary"> & {
    /** Norwegian summary when the detection has nb text; display only. */
    summaryNb?: string;
  };
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
    /** Distinct registrable domains contacted by third-party requests (count only). */
    thirdPartyDomains: number;
    since: number;
  };
  /**
   * Bundled and user-imported sets; imported ones carry `imported: true`. A curated set that
   * came from a verified signed bundle carries `signed` with the key id and activation time.
   */
  indicatorSets: Array<
    IndicatorSetMeta & {
      imported?: boolean;
      enabled?: boolean;
      signed?: { keyId: string; activatedAt: number; builtInVersion: string };
    }
  >;
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
  | {
      type: "export_handoff";
      detectionIds?: string[];
      profile: "default" | "strict";
      /** Optional free-text note for the recipient; goes into the cover note only, never stored. */
      note?: string;
      /** Cover-note languages; English is always included. Defaults to "en". */
      coverLanguages?: HandoffCoverLanguages;
    }
  // Dry run of export_handoff: what would be included, without producing a file
  | { type: "preview_handoff"; detectionIds?: string[]; profile: "default" | "strict" }
  // Phase 5: deterministic correlation and optional local-model assistance
  | { type: "get_clusters" }
  | { type: "get_cluster"; clusterId: string }
  | {
      type: "get_assist_package";
      detectionId?: string;
      clusterId?: string;
      language?: AssistLanguage;
    }
  | { type: "update_assist_settings"; patch: Partial<Settings["assist"]> }
  | { type: "update_ui_settings"; patch: Partial<Settings["ui"]> }
  // Exposure overview: documented-infrastructure contacts grouped per host
  | { type: "get_exposure" }
  // Seen alongside: hostnames observed in the same frame lineage as a documented host (read-only; never a detection)
  // `all: true` also returns every tracked host with its hit counters (for delta readers such as the rig).
  | { type: "get_alongside"; all?: boolean }
  // Phase 7: per-day counts (no URLs, no per-page records) for the morning line and calendar
  | { type: "get_digest" }
  // Phase 6: signed indicator bundles (offline, file-based)
  | { type: "verify_signed_bundle"; text: string }
  | { type: "activate_signed_bundle"; text: string }
  | { type: "remove_signed_bundle" };

/** Maximum length (UTF-16 units) of the free-text note on a hand-off package. */
export const HANDOFF_NOTE_MAX_LENGTH = 2000;

export type HandoffCoverLanguages = "en" | "en+nb";

/** What a hand-off package with the given scope and profile would contain. */
export interface HandoffPreview {
  detections: number;
  /** Supporting events referenced by the selected detections that are still stored. */
  events: number;
  /** Seen-alongside rows that would be included (0 when omitted by the strict profile). */
  seenAlongsideRows: number;
  /** True when the strict profile leaves the Seen-alongside hostnames out. */
  seenAlongsideOmitted: boolean;
  /** Earliest first-event and latest detection timestamps (epoch ms); absent without detections. */
  firstTimestamp?: number;
  lastTimestamp?: number;
}

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
  /** Norwegian summary of a detection entry when it has nb text; display only. */
  summaryNb?: string;
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

/** Preview of a signed bundle after verification, before activation. */
export interface SignedBundlePreview {
  ok: boolean;
  errors: string[];
  meta?: { version: string; createdAt: string; keyId: string; sha256: string; changelog: string[] };
  setId?: string;
  indicatorCount?: number;
  activeVersion?: string;
  diff?: {
    added: number;
    removed: number;
    reclassified: number;
    validityChanged: number;
    unchanged: number;
    /** Up to 50 human-readable lines describing the changes. */
    lines: string[];
  };
}

/** Result of an import: which set was added and what the validator said. */
export interface ImportResult {
  ok: boolean;
  setId?: string;
  indicatorCount?: number;
  errors: string[];
  warnings: string[];
}

/** A cluster with everything the cluster view needs. */
export interface ClusterDetail {
  cluster: DetectionCluster;
  detections: DetectionWithNote[];
  timeline: TimelineSummary;
  actions: SuggestedActions;
}

export type DetectionListItem = Detection;
export type EventListItem = NormalizedEvent;
