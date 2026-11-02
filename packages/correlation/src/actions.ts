/**
 * Suggested investigative actions derived from the shape of a cluster and the sensor's
 * capabilities. Deterministic; each suggestion names the observation that justifies it.
 */
import type {
  Detection,
  DetectionCluster,
  SensorCapabilities,
  SuggestedAction,
  SuggestedActions,
} from "@adtripwire/shared";
import { SEVERITY_RANK } from "./severity.js";

export const ACTIONS_DISCLAIMER =
  "These suggestions follow from the observed traffic and the sensor's visibility. They are not a verdict: network contact with documented infrastructure shows exposure to an ad-delivery path, not that spyware was delivered or installed.";

export function suggestActions(
  cluster: DetectionCluster,
  detections: readonly Detection[],
  caps: SensorCapabilities,
): SuggestedActions {
  const actions: SuggestedAction[] = [];
  const rank = SEVERITY_RANK[cluster.maxSeverity];
  const rules = new Set(cluster.ruleIds);
  const has = (cap: string): boolean => caps.capabilities.includes(cap as never);

  if (rank >= SEVERITY_RANK.elevated) {
    actions.push({
      id: "preserve_evidence",
      priority: "now",
      text: "Export a hand-off package now and keep a copy outside the browser.",
      rationale: `The cluster reaches ${cluster.maxSeverity.replace("_", " ")} priority; evidence is pruned by retention settings.`,
    });
  }
  if (rules.has("known_infra.malicious_contact") || rules.has("correlation.adfection_chain")) {
    actions.push({
      id: "specialist_review",
      priority: "soon",
      text: "If you may be a target of surveillance, share the hand-off package with a digital-security helpline or specialist for a device review.",
      rationale:
        "Public reporting describes the contacted infrastructure as part of a spyware-delivery path; the browser sensor cannot see whether anything followed on the device.",
    });
  }
  if (
    rules.has("known_infra.surveillance_contact") ||
    rules.has("exposure.repeated_surveillance_contact")
  ) {
    actions.push({
      id: "review_sites",
      priority: "soon",
      text: "Review which sites carried the ad slot (sanitized hostnames in the hand-off package) and whether the exposure repeats.",
      rationale:
        "Contact with documented ad-platform infrastructure was observed; repetition across sites raises priority.",
    });
  }
  if (!has("response_body_inspection")) {
    actions.push({
      id: "reproduce_firefox",
      priority: "optional",
      text: "Reproduce the browsing session in Firefox with response inspection enabled to gain visibility into script bodies.",
      rationale: `${caps.browser === "chromium" ? "Chromium" : "This browser"} exposes no response bodies, so technique markers inside scripts cannot be evaluated.`,
    });
  }
  if (
    !has("page_signals") &&
    cluster.categories.some((c) => c === "ad_delivery_behaviour" || c === "known_infrastructure")
  ) {
    actions.push({
      id: "enable_page_sensor",
      priority: "optional",
      text: "Enable the optional page sensor to add structural signals (hidden frames, late scripts) inside ad frames.",
      rationale:
        "The cluster involves ad-delivery traffic; the page sensor would corroborate or weaken it.",
    });
  }
  if (cluster.detectionIds.length > 1 && cluster.tabIds.length > 1) {
    actions.push({
      id: "compare_tabs",
      priority: "optional",
      text: "Compare the timelines of the involved tabs; shared infrastructure across unrelated sites points at the ad path rather than one site.",
      rationale: `Members span ${cluster.tabIds.length} tabs.`,
    });
  }
  if (actions.length === 0) {
    actions.push({
      id: "keep_monitoring",
      priority: "optional",
      text: "No action beyond awareness is suggested; keep monitoring and revisit if the pattern repeats or escalates.",
      rationale:
        "Members are informational or suspicious only and share no documented infrastructure.",
    });
  }

  const fromRules = [...new Set(detections.flatMap((d) => d.recommendedActions))];
  return { actions, fromRules, disclaimer: ACTIONS_DISCLAIMER };
}
