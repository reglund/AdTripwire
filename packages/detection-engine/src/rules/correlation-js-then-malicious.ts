import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { SEVERITY_RANK, buildDetection, lowerSeverity } from "./common.js";
import {
  CORRELATION_LIMITATIONS,
  findChain,
  isStep3,
  linkEvidence,
  scopeEvidence,
  scopeLimitations,
  step2Description,
} from "./correlation-common.js";
import { jsGrade } from "./js-common.js";

export const definition: RuleDefinition = {
  id: "correlation.suspicious_js_then_malicious_contact",
  name: "Suspicious script followed by contact with malicious infrastructure",
  version: "1.1.0",
  description:
    "Within the correlation window and the same frame lineage (same tab only: one level lower), a suspicious inspected script (or non-empty NOAS-pattern JavaScript) was followed by contact with infrastructure documented as malicious, without an observed ad-selection request beforehand.",
  category: "temporal_correlation",
  severity: "high_priority",
  confidence: "low",
  confidenceBasis:
    "Low, or medium when the script itself graded elevated (e.g. documented SDK strings). Without the ad-selection step the sequence is only partially observed, and temporal proximity does not prove causation.",
  requiredEvidence: [
    "A non-empty NOAS-pattern JavaScript response or a response_inspected event graded suspicious or higher.",
    "A later request to a malicious-classified indicator in the same frame lineage within the correlation window (same tab only: one severity level lower).",
  ],
  requiredCapabilities: ["request_metadata", "response_body_inspection"],
  references: BOTH,
  limitations: CORRELATION_LIMITATIONS,
  falsePositiveConsiderations: [
    "Pages that discuss or analyse the campaign may load both kinds of content.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (!isStep3(event, ctx)) return [];
  const c = findChain(event, ctx);
  // Prefer the lineage result: an ad-selection request in an unrelated frame of the tab must not
  // suppress this rule (the downgraded tab-level adfection chain is reported separately).
  let s2: NormalizedEvent;
  let scope = c.scope;
  let ancestryUnavailable = c.ancestryUnavailable;
  if (c.lineageS2Only) {
    s2 = c.lineageS2Only;
    scope = "lineage";
    ancestryUnavailable = false;
  } else if (!c.s1 && c.s2) {
    s2 = c.s2;
  } else return [];
  const tabStepElsewhere = c.s1 !== undefined;
  const g = s2.responseInspection ? jsGrade(s2.responseInspection.markers) : null;
  const strong = g !== null && SEVERITY_RANK[g] >= SEVERITY_RANK.elevated;
  const host = event.destination.hostname;
  const malicious = ctx
    .indicatorMatches(event)
    .filter((m) => m.indicator.classification === "malicious");
  return [
    buildDetection(definition, ctx, {
      subject: `${event.tabId ?? event.correlationId ?? ""}|${host}`,
      severity: scope === "lineage" ? "high_priority" : lowerSeverity("high_priority"),
      confidence: strong ? "medium" : "low",
      confidenceRationale: `${strong ? "The script graded elevated on its own" : "The script graded suspicious"}, and contact with documented malicious infrastructure followed. No ad-selection request was observed first, and temporal proximity does not prove causation.`,
      summary:
        "A script with suspicious techniques was followed in the same tab by contact with infrastructure documented as malicious.",
      significance:
        "This resembles the later part of the documented delivery chain. It is a high investigation priority, not confirmation that anything executed on this device.",
      evidence: [
        { eventIds: [s2.eventId], observed: step2Description(s2), kind: "observed" },
        {
          eventIds: [event.eventId],
          observed: `Request to ${host}, documented as malicious infrastructure (${malicious.map((m) => m.indicator.id).join(", ")}).`,
          kind: "observed",
        },
        linkEvidence(s2, event, "Link from script to infrastructure contact", scope),
        scopeEvidence(scope, ancestryUnavailable, [s2, event]),
        {
          eventIds: [],
          observed: tabStepElsewhere
            ? "No ad-selection (NOAS/getAd) request was observed before the script in the same frame lineage; one occurred in another frame of the tab and is reported separately."
            : "No ad-selection (NOAS/getAd) request was observed before the script in this window.",
          kind: "inferred",
        },
      ],
      extraLimitations: scopeLimitations(scope, ancestryUnavailable),
      events: [s2, event],
      matchedIndicatorIds: malicious.map((m) => m.indicator.id),
      subjectHostnames: [s2.destination.hostname, host],
      alternativeExplanations: [
        "The script and the infrastructure contact may be unrelated.",
        "The page may be a research or security resource that references the infrastructure.",
      ],
      recommendedActions: [
        "Export the evidence bundle before clearing browser data.",
        "Contact a digital-security helpline if you believe you may be a target.",
      ],
    }),
  ];
}

export const rule: Rule = {
  definition,
  evaluate,
};
