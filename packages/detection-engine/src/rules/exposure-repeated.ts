import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { RULE_VERSION, buildDetection, dayKeyUtc, isFirstObservation } from "./common.js";

export const REPEATED_EXPOSURE_MIN_DAYS = 3;

export const definition: RuleDefinition = {
  id: "exposure.repeated_surveillance_contact",
  name: "Repeated contact with surveillance-associated infrastructure",
  version: RULE_VERSION,
  description: `A host classified as surveillance-associated was contacted on ${REPEATED_EXPOSURE_MIN_DAYS} or more distinct days. This measures exposure over time and is kept distinct from targeted delivery.`,
  category: "repeated_exposure",
  severity: "informational",
  confidence: "medium",
  confidenceBasis:
    "Medium confidence that repeated contact occurred (counts are direct); it says nothing about targeting, and repeated contact may be ordinary advertising behaviour.",
  requiredEvidence: [
    `Contacts with one surveillance-classified hostname on at least ${REPEATED_EXPOSURE_MIN_DAYS} distinct UTC days.`,
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: [
    "Day counts are kept per hostname in local storage only and reset if storage is cleared.",
    "Private-browsing activity may be excluded.",
  ],
  falsePositiveConsiderations: [
    "Ad networks reach most users repeatedly; repeated exposure is expected for widely used ad infrastructure.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (
    !isFirstObservation(event, ctx) ||
    event.eventType === "request_error" ||
    event.eventType === "request_redirected"
  )
    return [];
  const matches = ctx
    .indicatorMatches(event)
    .filter((m) => m.indicator.classification === "surveillance");
  if (matches.length === 0) return [];
  const host = event.destination.hostname;
  const newDay = ctx.exposure.record(host, dayKeyUtc(event.timestamp));
  const days = ctx.exposure.distinctDays(host);
  if (!newDay || days < REPEATED_EXPOSURE_MIN_DAYS) return [];
  return [
    buildDetection(definition, ctx, {
      subject: host,
      confidenceRationale:
        "The number of distinct contact days was counted directly; this measures exposure, not targeting.",
      summary: `Repeated contact with infrastructure documented in the AdFection investigation was observed on ${days} distinct days. Repeated contact may be ordinary advertising behaviour.`,
      significance:
        "Repeated exposure may reflect ordinary ad delivery, profiling by the operator's ad network, or both. It is not evidence of a targeted attack.",
      evidence: [
        {
          eventIds: [event.eventId],
          observed: `Contact with ${host} today; ${days} distinct days recorded locally.`,
          kind: "observed",
        },
      ],
      events: [event],
      matchedIndicatorIds: matches.map((m) => m.indicator.id),
      subjectHostnames: [host],
      alternativeExplanations: [
        "Ordinary repeated ad delivery from a widely used network.",
        "A frequently visited site embeds this ad network.",
      ],
      recommendedActions: [
        "Consider an ad or tracker blocker to reduce exposure.",
        "No other action is needed unless stronger detections appear.",
      ],
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
