export interface RetentionSettings {
  /** Days to keep detections and their supporting events. */
  detectionRetentionDays: number;
  /** Maximum number of detections kept regardless of age. */
  maxDetections: number;
  /** Maximum number of persisted events. */
  maxEvents: number;
}

export interface MonitoringSettings {
  enabled: boolean;
  /** Inspect response bodies of narrowly selected scripts (Firefox only). */
  responseInspectionEnabled: boolean;
  /** Maximum bytes analysed per inspected response. */
  responseInspectionMaxBytes: number;
  /** Exclude private browsing windows from observation. */
  excludeIncognito: boolean;
  /** Correlation window in milliseconds for temporal rules. */
  correlationWindowMs: number;
  /**
   * Opt-in page sensor: an isolated-world content script in sub-frames that reports
   * structural signals (hidden iframe insertion, SDK postMessage). Off by default.
   */
  pageSensorEnabled: boolean;
}

/**
 * Optional local-model assistance (Phase 5). Only present in builds made with `--assist`;
 * the default build has no network capability at all. The endpoint is always loopback.
 */
export interface AssistSettings {
  enabled: boolean;
  /** TCP port of an Ollama-compatible runtime on 127.0.0.1. */
  port: number;
  /** Model name as listed by the runtime; empty means "not chosen yet". */
  model: string;
  language: "en" | "nb";
}

export interface Settings {
  monitoring: MonitoringSettings;
  retention: RetentionSettings;
  assist: AssistSettings;
  /** Settings schema version for migrations. */
  schemaVersion: 1;
}

export const DEFAULT_SETTINGS: Settings = {
  monitoring: {
    enabled: true,
    responseInspectionEnabled: true,
    responseInspectionMaxBytes: 512 * 1024,
    excludeIncognito: true,
    correlationWindowMs: 5 * 60 * 1000,
    pageSensorEnabled: false,
  },
  retention: {
    detectionRetentionDays: 7,
    maxDetections: 2000,
    maxEvents: 20000,
  },
  assist: {
    enabled: false,
    port: 11434,
    model: "",
    language: "en",
  },
  schemaVersion: 1,
};
