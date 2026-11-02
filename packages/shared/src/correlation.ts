/**
 * Phase 5 contracts: deterministic correlation on top of detections, and the optional
 * local-model assistance layer. Nothing here changes a detection: clusters, summaries and
 * suggested actions are derived views, and model output is interpretation that is screened
 * and labelled before display.
 */
import type { Detection, DetectionCategory, Severity } from "./detections.js";

/** Why two detections were placed in the same cluster. */
export type ClusterLinkReason =
  | "shared_event" // both cite the same observed event
  | "shared_indicator" // both matched the same indicator id
  | "shared_hostname" // both name the same subject hostname
  | "shared_domain" // subject hostnames share a registrable domain
  | "same_tab_window"; // same tab, within the correlation window of each other

export interface ClusterLink {
  from: string;
  to: string;
  reason: ClusterLinkReason;
  /** The shared key (event id, indicator id, hostname, domain) or the tab id. */
  key: string;
}

/** A group of detections that share infrastructure, evidence or a tab/time window. */
export interface DetectionCluster {
  /** Stable while the oldest member is retained: derived from the oldest detection id. */
  clusterId: string;
  /** Member detection ids in chronological order. */
  detectionIds: string[];
  firstTimestamp: number;
  lastTimestamp: number;
  maxSeverity: Severity;
  categories: DetectionCategory[];
  ruleIds: string[];
  tabIds: number[];
  /** Union of member subject hostnames (sanitized). */
  hostnames: string[];
  registrableDomains: string[];
  indicatorIds: string[];
  links: ClusterLink[];
  /** Deterministic, conservative one-paragraph summary. */
  summary: string;
}

export interface TimelineStep {
  timestamp: number;
  /** Milliseconds since the first step. */
  offsetMs: number;
  kind: "detection" | "event";
  detectionId?: string;
  eventId?: string;
  severity?: Severity;
  text: string;
}

export interface TimelineSummary {
  steps: TimelineStep[];
  durationMs: number;
  tabCount: number;
  /** Deterministic narrative built from the steps. */
  text: string;
  /** True when steps were capped. */
  truncated: boolean;
}

export type ActionPriority = "now" | "soon" | "optional";

export interface SuggestedAction {
  id: string;
  priority: ActionPriority;
  text: string;
  /** Which observation justifies the suggestion. */
  rationale: string;
}

export interface SuggestedActions {
  actions: SuggestedAction[];
  /** Deduplicated recommendations carried over from the member detections' rules. */
  fromRules: string[];
  /** Always shown next to the actions. */
  disclaimer: string;
}

export type AssistLanguage = "en" | "nb";

/**
 * The ONLY data that may be handed to a local model. Built from detections and sanitized
 * events by a single allowlisting function; analyst notes are never included.
 */
export interface AssistContext {
  language: AssistLanguage;
  productVersion: string;
  browser: string;
  capabilities: string[];
  generatedAt: number;
  /** Sanitized hostnames the model is allowed to mention. */
  hostnames: string[];
  /** Hostnames of source references (documentation sites), also allowed. */
  referenceHostnames: string[];
  detections: AssistDetectionView[];
  events: AssistEventView[];
  timeline: string;
  suggestedActions: string[];
  /** Cluster summary when the context covers a cluster. */
  clusterSummary?: string;
}

export interface AssistDetectionView {
  ruleId: string;
  ruleName: string;
  category: DetectionCategory;
  severity: Severity;
  confidence: Detection["confidence"];
  confidenceRationale: string;
  summary: string;
  significance: string;
  observed: string[];
  alternativeExplanations: string[];
  missingVisibility: string[];
  subjectHostnames: string[];
  matchedIndicatorIds: string[];
  /** Seconds since the first detection in the context. */
  offsetSeconds: number;
}

export interface AssistEventView {
  offsetSeconds: number;
  eventType: string;
  resourceType?: string;
  hostname: string;
  pathPattern: string;
  statusCode?: number;
  thirdParty?: boolean;
  frameDepth: number;
  markers: string[];
  limitations: string[];
}

/** Rendered prompt plus the context it was rendered from; shown to the user before sending. */
export interface AssistPackage {
  context: AssistContext;
  system: string;
  user: string;
}

export type GuardrailFlag =
  | "asserted_compromise" // model stated the device/user is infected, hacked, spied on…
  | "asserted_safety" // model stated the device/user is safe/clean
  | "hedged_claim" // a verdict-shaped sentence was kept because it was explicitly hedged
  | "unknown_hostname" // model named a hostname or IP address not present in the evidence
  | "severity_language" // model used priority language above the evidence
  | "instruction_echo" // output looks like a prompt-injection echo
  | "contains_url" // output contained a URL (rendered as text, never a link)
  | "truncated"; // output exceeded the length cap

export interface ScreenedAssistOutput {
  /** Screened text, safe to display as plain text. */
  text: string;
  flags: GuardrailFlag[];
  /** Number of sentences removed because they asserted compromise or safety. */
  removedSentences: number;
  /** Number of hostnames masked because they were not in the evidence. */
  maskedHostnames: number;
}
