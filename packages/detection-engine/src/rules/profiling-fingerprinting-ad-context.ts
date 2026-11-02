import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH, MDN_URL_CLASSIFICATION } from "./references.js";
import {
  RULE_VERSION,
  buildDetection,
  hasAnyFlag,
  isFirstObservation,
  relatedEvents,
} from "./common.js";
import { isNoasContact } from "./noas.js";

export const definition: RuleDefinition = {
  id: "profiling.fingerprinting_classified_in_ad_context",
  name: "Fingerprinting-classified request near documented ad infrastructure",
  version: RULE_VERSION,
  description:
    "Firefox classified a request as fingerprinting, and the same tab contacted NOAS/getAd-pattern or documented infrastructure within the correlation window.",
  category: "profiling",
  severity: "suspicious",
  confidence: "low",
  confidenceBasis:
    "Low: Firefox's fingerprinting list is broad, and co-occurrence in a tab does not show the two are related. The rule only corroborates other signals.",
  requiredEvidence: [
    "Firefox urlClassification includes 'fingerprinting' (not 'fingerprinting_content').",
    "A NOAS/getAd-pattern request or malicious/surveillance indicator contact in the same tab within the correlation window.",
  ],
  requiredCapabilities: ["request_metadata", "url_classification"],
  references: [...BOTH, MDN_URL_CLASSIFICATION],
  limitations: [
    "Firefox classification is list-based and only reflects the request host, not the script's behaviour.",
  ],
  falsePositiveConsiderations: [
    "Many mainstream ad and anti-fraud scripts are classified as fingerprinting.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (!hasAnyFlag(event, "fingerprinting")) return [];
  if (!isFirstObservation(event, ctx) || event.eventType === "request_error") return [];
  const anchor = relatedEvents(event, ctx).find(
    (e) =>
      isNoasContact(e, ctx) ||
      ctx
        .indicatorMatches(e)
        .some(
          (m) =>
            m.indicator.classification === "malicious" ||
            m.indicator.classification === "surveillance",
        ),
  );
  if (!anchor) return [];
  const host = event.destination.hostname;
  return [
    buildDetection(definition, ctx, {
      subject: `${host}|${event.tabId ?? event.correlationId ?? ""}`,
      confidenceRationale:
        "Both observations are direct, but the link between them is inferred from tab and time only.",
      summary:
        "A fingerprinting-classified request occurred in the same tab as contact with documented ad-selection infrastructure.",
      significance:
        "The documented operation profiled devices before deciding whether to deliver further code. This co-occurrence corroborates, but does not establish, such profiling.",
      evidence: [
        {
          eventIds: [event.eventId],
          observed: "Firefox classified this request as fingerprinting.",
          kind: "observed",
        },
        {
          eventIds: [anchor.eventId],
          observed: `Earlier contact with ${anchor.destination.hostname} in the same tab.`,
          kind: "observed",
        },
        {
          eventIds: [anchor.eventId, event.eventId],
          observed:
            "The two requests are assumed related only because they share a tab and time window.",
          kind: "inferred",
        },
      ],
      events: [anchor, event],
      subjectHostnames: [host, anchor.destination.hostname],
      alternativeExplanations: [
        "Unrelated anti-fraud or analytics fingerprinting on the same page.",
        "Coincidental timing on an ad-heavy page.",
      ],
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
