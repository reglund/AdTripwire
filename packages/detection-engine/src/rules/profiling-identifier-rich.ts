import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { identifierParams } from "../params.js";
import {
  RULE_VERSION,
  buildDetection,
  hasThirdPartyFlag,
  isFirstObservation,
  isThirdParty,
} from "./common.js";

export const definition: RuleDefinition = {
  id: "profiling.identifier_rich_request",
  name: "Third-party request carrying identifier-style parameters",
  version: RULE_VERSION,
  description:
    "A third-party request carried three or more identifier-category parameter names (device ids, network identity, location, device profile, contact) or a parameter name suggesting cookie material. Only names are inspected; values are never stored.",
  category: "profiling",
  severity: "informational",
  confidence: "low",
  confidenceBasis:
    "Low: parameter names indicate what a request is labelled as carrying, not what it actually carries. Raised to suspicious only when cookie-material names appear in a request Firefox classifies as advertising.",
  requiredEvidence: [
    "Third-party request.",
    "Three or more identifier-category parameter names, or a cookie-material parameter name.",
  ],
  requiredCapabilities: ["request_metadata", "third_party_flag"],
  references: BOTH,
  limitations: [
    "Parameter names are not standardised; the same names are used for unrelated purposes.",
    "Parameter values are deliberately never inspected or stored.",
  ],
  falsePositiveConsiderations: [
    "Ordinary ad and analytics requests routinely carry device and location parameters.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (!isFirstObservation(event, ctx) || event.eventType === "request_error") return [];
  if (!isThirdParty(event)) return [];
  const p = identifierParams(event.destination.queryParamNames);
  if (p.count < 3 && !p.hasCookieMaterial) return [];
  const adContext = hasThirdPartyFlag(event, "tracking_ad");
  const escalate = p.hasCookieMaterial && adContext;
  const host = event.destination.hostname;
  return [
    buildDetection(definition, ctx, {
      subject: host,
      severity: escalate ? "suspicious" : "informational",
      confidence: "low",
      confidenceRationale: escalate
        ? "A parameter name suggesting cookie material appeared in a request Firefox classifies as advertising; the documented operation sent collected cookies in such parameters. Values were not inspected, so this remains low confidence."
        : "Identifier-style parameter names are common in ordinary ad and analytics traffic.",
      summary: escalate
        ? "A third-party advertising request carried a parameter name suggesting cookie material."
        : "A third-party request carried several identifier-style parameter names.",
      significance:
        "The documented operation collected device identifiers and first-party cookie material through ad requests. This records the pattern of parameter names only.",
      evidence: [
        {
          eventIds: [event.eventId],
          observed: `Identifier categories present: ${p.categories.join(", ") || "none"}; cookie-material parameter name ${p.hasCookieMaterial ? "present" : "absent"}. Values were not recorded.`,
          kind: "observed",
        },
      ],
      events: [event],
      subjectHostnames: [host],
      alternativeExplanations: [
        "Ordinary ad targeting or analytics parameters.",
        "A parameter name coincides with an identifier label but carries something else.",
      ],
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
