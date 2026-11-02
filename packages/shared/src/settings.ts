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
}

export interface Settings {
  monitoring: MonitoringSettings;
  retention: RetentionSettings;
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
  },
  retention: {
    detectionRetentionDays: 7,
    maxDetections: 2000,
    maxEvents: 20000,
  },
  schemaVersion: 1,
};
