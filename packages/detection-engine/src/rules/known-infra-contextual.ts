import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { buildDetection, classMatches } from "./common.js";
import {
  EXPIRED_LIMITATION,
  allExpired,
  contactMatches,
  describeMatch,
  indicatorReferences,
} from "./known-infra-common.js";

export const definition: RuleDefinition = {
  id: "known_infra.contextual_contact",
  name: "Contact with a contextual (attribution-related) host",
  version: "1.1.0",
  description:
    "A request was made to a corporate or attribution-related host named in research. This is a lead for an analyst, not a finding.",
  category: "known_infrastructure",
  severity: "informational",
  confidence: "low",
  confidenceBasis:
    "Contextual hosts are named for attribution or background; they are not documented as part of a delivery chain, so confidence is always low.",
  requiredEvidence: [
    "Request destination hostname matching an enabled indicator classified 'contextual'.",
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: [
    "Contextual hosts include ordinary corporate websites; visiting them is unremarkable.",
  ],
  falsePositiveConsiderations: [
    "Reading about the companies involved will produce this detection.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  const all = contactMatches(event, ctx);
  if (all.some((m) => m.indicator.classification !== "contextual")) return [];
  const matches = classMatches(all, "contextual");
  if (matches.length === 0) return [];
  const host = event.destination.hostname;
  return [
    buildDetection(definition, ctx, {
      subject: host,
      ...(allExpired(matches)
        ? { limitations: [...definition.limitations, EXPIRED_LIMITATION] }
        : {}),
      confidenceRationale:
        "Contextual leads are named in research for background or attribution only; contact carries no implication of targeting.",
      summary:
        "Traffic to a host named as background context in the AdFection research was observed.",
      significance:
        "This is a lead for an analyst reviewing a broader timeline, not a finding on its own.",
      evidence: matches.map((m) => ({
        eventIds: [event.eventId],
        observed: describeMatch(m),
        kind: "observed" as const,
      })),
      events: [event],
      matchedIndicatorIds: matches.map((m) => m.indicator.id),
      subjectHostnames: [host],
      alternativeExplanations: [
        "Visiting a company website or reading news about it produces the same traffic.",
      ],
      recommendedActions: [
        "No action is needed unless other detections occurred around the same time.",
      ],
      references: indicatorReferences(matches, definition.references),
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
