import type { Detection } from "./detections.js";
import type { NormalizedEvent } from "./events.js";
import type { SensorCapabilities } from "./capabilities.js";

export interface RedactionMetadata {
  /** Redaction profile applied. */
  profile: "default" | "strict";
  /** Which field classes were redacted or omitted. */
  redactedFields: string[];
  /** True when hostnames were pseudonymised (strict profile). */
  hostnamesPseudonymised: boolean;
  note: string;
}

export interface EvidenceExport {
  schema: "adtripwire.evidence-export";
  schemaVersion: "1.0.0";
  productVersion: string;
  exportedAt: string;
  browser: SensorCapabilities;
  rulesetVersion: string;
  indicatorSets: Array<{ id: string; version: string; asOf: string; license: string }>;
  detections: Detection[];
  events: NormalizedEvent[];
  visibilityLimitations: string[];
  redaction: RedactionMetadata;
  /** Mandatory disclaimer, always present. */
  disclaimer: string;
}
