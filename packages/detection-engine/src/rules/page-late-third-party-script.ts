import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { buildDetection } from "./common.js";
import { linkEvidence } from "./correlation-common.js";
import {
  PAGE_FALSE_POSITIVES,
  PAGE_LIMITATIONS,
  lineageNoasContact,
  pageSignalOf,
  signalFrameHost,
  timing,
} from "./page-common.js";

export const definition: RuleDefinition = {
  id: "page.late_third_party_script",
  name: "Third-party script inserted after load",
  version: "1.0.0",
  description:
    "The opt-in page sensor observed a cross-origin script element inserted after the frame loaded. Informational alone; suspicious after a NOAS/getAd-pattern request in the same frame lineage.",
  category: "ad_delivery_behaviour",
  severity: "suspicious",
  confidence: "medium",
  confidenceBasis:
    "Low on its own: late script insertion is how most ad tags work. Medium with a NOAS contact in the same frame lineage, matching the documented step where selected devices received code that loaded further scripts.",
  requiredEvidence: [
    "page_signal of kind script_inserted with crossOrigin true.",
    "For suspicious: a NOAS/getAd-pattern request or NOAS indicator contact in the same frame lineage within the correlation window.",
  ],
  requiredCapabilities: ["page_signals"],
  references: BOTH,
  limitations: PAGE_LIMITATIONS,
  falsePositiveConsiderations: [
    ...PAGE_FALSE_POSITIVES,
    "Tag managers and header-bidding wrappers insert many third-party scripts after load.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  const p = pageSignalOf(event, "script_inserted");
  if (!p || p.crossOrigin !== true) return [];
  const host = signalFrameHost(event);
  const target = p.targetHostname;
  const noas = lineageNoasContact(event, ctx);
  const observed = {
    eventIds: [event.eventId],
    observed: `The page sensor observed a third-party script${target ? ` from ${target}` : ""} inserted${timing(p)} in a frame on ${host}.`,
    kind: "observed" as const,
  };
  return [
    buildDetection(definition, ctx, {
      subject: `${event.tabId ?? ""}|${host}|${target ?? ""}`,
      severity: noas ? "suspicious" : "informational",
      confidence: noas ? "medium" : "low",
      confidenceRationale: noas
        ? "The script insertion was observed directly and followed an ad-selection request in the same frame lineage; the link is inferred from lineage and timing."
        : "Late third-party script insertion is ordinary ad-tag behaviour; this is context only.",
      summary: noas
        ? "An ad-selection request was followed in the same frame lineage by insertion of a third-party script."
        : "A third-party script was inserted after load.",
      significance:
        "In the documented chain, code returned to selected devices loaded further scripts toward validator infrastructure. On its own, late script insertion is very common.",
      evidence: noas
        ? [
            {
              eventIds: [noas.eventId],
              observed: `Earlier ad-selection (NOAS/getAd) request to ${noas.destination.hostname} in the same frame lineage.`,
              kind: "observed",
            },
            observed,
            linkEvidence(
              noas,
              event,
              "Link from ad-selection request to script insertion",
              "lineage",
            ),
          ]
        : [observed],
      events: noas ? [noas, event] : [event],
      matchedIndicatorIds: noas ? ctx.indicatorMatches(noas).map((m) => m.indicator.id) : [],
      subjectHostnames: [
        host,
        ...(target ? [target] : []),
        ...(noas ? [noas.destination.hostname] : []),
      ],
      alternativeExplanations: [
        "An ordinary ad tag, tag manager or header-bidding wrapper loading its components.",
      ],
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
