import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { RULE_VERSION, buildDetection, isFirstObservation, isThirdParty } from "./common.js";
import { isNoasPattern } from "./noas.js";

export const definition: RuleDefinition = {
  id: "ad_delivery.noas_request",
  name: "Request matching the documented NOAS/getAd selection pattern",
  version: RULE_VERSION,
  description:
    "A request used the '/getAd' or '/cplatform/getAd' path with device- or identity-describing query parameters, the pattern documented for the AdFection per-device selection servers.",
  category: "ad_delivery_behaviour",
  severity: "suspicious",
  confidence: "medium",
  confidenceBasis:
    "Medium when the request is third-party or comes from a sub-frame (as documented for ad creatives); low otherwise. The path name alone is generic, so the parameter-name requirement narrows it.",
  requiredEvidence: [
    "Path pattern exactly '/getAd' or '/cplatform/getAd' (case-sensitive 'getAd').",
    "Resource type script, xmlhttprequest, sub_frame, image or other.",
    "At least one identifier-like query parameter name (e.g. idfa, sourceid, ipv4, devicemodel).",
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: [
    "'getAd' is a common endpoint name in unrelated ad software; only parameter names, not values, are inspected.",
    "Whether the server selected this device is decided server-side and is not visible from the request.",
  ],
  falsePositiveConsiderations: [
    "Legitimate ad servers may use the same path name and similar targeting parameters.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (!isFirstObservation(event, ctx) || event.eventType === "request_error") return [];
  if (!isNoasPattern(event)) return [];
  const host = event.destination.hostname;
  const adContext = isThirdParty(event) || event.frameContext.depth >= 1;
  const matches = ctx
    .indicatorMatches(event)
    .filter((m) => m.indicator.classification !== "contextual");
  const indicatorNote =
    matches.length > 0
      ? ` The destination also matches documented indicator ${matches[0]!.indicator.id}.`
      : "";
  const params = event.destination.queryParamNames.slice(0, 20).join(", ");
  return [
    buildDetection(definition, ctx, {
      subject: host,
      severity: adContext ? "suspicious" : "informational",
      confidence: adContext ? "medium" : "low",
      confidenceRationale: adContext
        ? "The request matches the documented path and parameter pattern and was issued from a third-party or embedded-frame context, as documented for ad creatives."
        : "The request matches the documented path and parameter pattern but was issued from a first-party, top-level context, which is less consistent with the documented ad-creative delivery.",
      summary: `A request matching the documented NOAS/getAd ad-selection pattern was observed.${indicatorNote}`,
      significance:
        "Documented selection servers decide per device whether to return code. Most devices receive nothing; the request itself indicates exposure to selection infrastructure, not selection.",
      evidence: [
        {
          eventIds: [event.eventId],
          observed: `Request path pattern '${event.destination.pathPattern}' with parameter names: ${params}.`,
          kind: "observed",
        },
      ],
      events: [event],
      matchedIndicatorIds: matches.map((m) => m.indicator.id),
      subjectHostnames: [host],
      alternativeExplanations: [
        "An unrelated ad server may use the same endpoint name and similar parameter names.",
        "The request may be part of ordinary programmatic ad delivery.",
      ],
      recommendedActions: [
        "Check whether the response was empty (typical) or contained JavaScript (less common).",
      ],
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
