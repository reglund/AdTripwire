import type { Confidence } from "./indicators.js";
import type { DetectionCategory, Severity } from "./detections.js";
import type { SensorCapability } from "./capabilities.js";

/** Norwegian (bokmål) counterparts of the RuleDefinition text fields. */
export interface RuleDefinitionNb {
  name: string;
  description: string;
  confidenceBasis: string;
  limitations: string[];
  falsePositiveConsiderations: string[];
}

/** Static, documentation-grade metadata every rule must declare. */
export interface RuleDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  category: DetectionCategory;
  /** Default severity when the rule fires; rules may adjust downward with context. */
  severity: Severity;
  /** Default confidence and what establishes it. */
  confidence: Confidence;
  confidenceBasis: string;
  requiredEvidence: string[];
  /** Capabilities the sensor must provide for the rule to be evaluable. */
  requiredCapabilities: SensorCapability[];
  references: Array<{ title: string; url: string }>;
  limitations: string[];
  falsePositiveConsiderations: string[];
  nb?: RuleDefinitionNb;
}
