import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { RULE_VERSION, buildDetection, classMatches } from "./common.js";
import {
  INFRA_FALSE_POSITIVES,
  INFRA_LIMITATIONS,
  contactMatches,
  describeMatch,
  indicatorReferences,
} from "./known-infra-common.js";

export const definition: RuleDefinition = {
  id: "known_infra.surveillance_contact",
  name: "Contact with documented surveillance-associated ad infrastructure",
  version: RULE_VERSION,
  description:
    "A request was made to advertising or tracking infrastructure that published research associates with the AdFection surveillance operation. Selection-server (NOAS) contact is rated higher than tracking contact.",
  category: "known_infrastructure",
  severity: "suspicious",
  confidence: "high",
  confidenceBasis:
    "Confidence is inherited from the indicator record and reflects the infrastructure attribution only. Contact with this kind of infrastructure is common exposure and is low-confidence evidence of personal targeting.",
  requiredEvidence: [
    "Request destination hostname matching an enabled indicator classified 'surveillance'.",
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: INFRA_LIMITATIONS,
  falsePositiveConsiderations: [
    ...INFRA_FALSE_POSITIVES,
    "Cookie-sync and impression-tracking hosts are contacted at very large scale during ordinary browsing.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  const all = contactMatches(event, ctx);
  if (classMatches(all, "malicious").length > 0) return []; // reported by the malicious rule
  const matches = classMatches(all, "surveillance");
  const top = matches[0];
  if (!top) return [];
  const host = event.destination.hostname;
  const isNoas = matches.some((m) => m.indicator.role === "noas");
  const isTracking = !isNoas && matches.some((m) => m.indicator.role === "tracking");
  const severity = isNoas ? "elevated" : "suspicious";
  const summary = isNoas
    ? "Traffic to an ad-selection (NOAS/getAd) server documented in the AdFection investigation was observed."
    : isTracking
      ? "Traffic to ad-tracking infrastructure documented in the AdFection investigation was observed. This is very common exposure."
      : "Traffic to infrastructure documented in the AdFection investigation was observed.";
  const significance = isNoas
    ? "The documented selection servers decide per device whether to return anything. Contact indicates exposure to the selection infrastructure, not that this device was selected."
    : isTracking
      ? "This is very common exposure: documented tracking hosts are contacted at very large scale by ordinary ad traffic. It is not evidence of targeting on its own."
      : "This infrastructure was documented as part of the operator's ad-delivery footprint. Contact alone is exposure, not evidence of targeting.";
  return [
    buildDetection(definition, ctx, {
      subject: host,
      severity,
      confidence: top.indicator.confidence,
      confidenceRationale: `Indicator ${top.indicator.id} is rated ${top.indicator.confidence} confidence by its source. That is confidence in the infrastructure attribution; as evidence of personal targeting this contact is low confidence${isTracking ? " (very common exposure)" : ""}.`,
      summary,
      significance,
      evidence: matches.map((m) => ({
        eventIds: [event.eventId],
        observed: describeMatch(m),
        kind: "observed" as const,
      })),
      events: [event],
      matchedIndicatorIds: matches.map((m) => m.indicator.id),
      subjectHostnames: [host],
      alternativeExplanations: [
        "Ordinary programmatic advertising routes requests through many intermediaries, including this one.",
        "The page you visited may simply have carried an ad served through this network.",
      ],
      recommendedActions: [
        "Consider an ad or tracker blocker to reduce exposure to ad-delivery infrastructure.",
        "Look for follow-on detections (JavaScript responses, hidden frames, or malicious infrastructure) in the same tab.",
      ],
      references: indicatorReferences(matches, definition.references),
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
