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
  id: "known_infra.malicious_contact",
  name: "Contact with documented malicious infrastructure",
  version: RULE_VERSION,
  description:
    "A request was made to a hostname that published research documents as spyware command-and-control, validator, or exploit-delivery infrastructure.",
  category: "known_infrastructure",
  severity: "elevated",
  confidence: "high",
  confidenceBasis:
    "Confidence is inherited from the indicator record (how firmly researchers attributed the infrastructure). It is confidence in the infrastructure attribution, not in personal targeting or spyware execution.",
  requiredEvidence: [
    "Request destination hostname matching an enabled indicator classified 'malicious'.",
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: INFRA_LIMITATIONS,
  falsePositiveConsiderations: INFRA_FALSE_POSITIVES,
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  const matches = classMatches(contactMatches(event, ctx), "malicious");
  const top = matches[0];
  if (!top) return [];
  const host = event.destination.hostname;
  return [
    buildDetection(definition, ctx, {
      subject: host,
      confidence: top.indicator.confidence,
      confidenceRationale: `Indicator ${top.indicator.id} is rated ${top.indicator.confidence} confidence by its source. Infrastructure attribution is not the same as personal targeting: this establishes only that the destination was documented as malicious infrastructure, not that anything was delivered to or executed on this device.`,
      summary:
        "Traffic to infrastructure documented as spyware-related in published research was observed.",
      significance:
        "Researchers documented this infrastructure as part of a spyware delivery or control chain. A single contact can have innocent causes, but it warrants review together with any surrounding activity.",
      evidence: matches.map((m) => ({
        eventIds: [event.eventId],
        observed: describeMatch(m),
        kind: "observed" as const,
      })),
      events: [event],
      matchedIndicatorIds: matches.map((m) => m.indicator.id),
      subjectHostnames: [host],
      alternativeExplanations: [
        "The domain may have been re-registered or repurposed since it was documented.",
        "A link preview, security scanner, or another extension may have caused the request.",
        "You may have opened a link to the domain while reading about the research.",
      ],
      recommendedActions: [
        "Note the time and the page you were on when this occurred.",
        "Check whether other detections in the same tab occurred around the same time.",
        "Export the evidence and consult a digital-security helpline if you believe you may be a target.",
      ],
      references: indicatorReferences(matches, definition.references),
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
