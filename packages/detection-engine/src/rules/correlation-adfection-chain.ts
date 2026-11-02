import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { RULE_VERSION, buildDetection } from "./common.js";
import {
  CORRELATION_LIMITATIONS,
  findChain,
  isStep3,
  linkEvidence,
  step2Description,
  isFirstPartyStep,
} from "./correlation-common.js";

export const definition: RuleDefinition = {
  id: "correlation.adfection_chain",
  name: "Sequence consistent with the documented AdFection delivery chain",
  version: RULE_VERSION,
  description:
    "Within the correlation window and the same tab: (1) a NOAS/getAd-pattern request or NOAS indicator contact, then (2) a non-empty JavaScript response for it or a suspicious inspected script, then (3) contact with infrastructure documented as malicious.",
  category: "temporal_correlation",
  severity: "high_priority",
  confidence: "medium",
  confidenceBasis:
    "Medium: each step is observed directly and the order matches the documented chain, but the links between steps are inferred from tab and timing, and temporal proximity does not prove causation.",
  requiredEvidence: [
    "Step 1: NOAS/getAd-pattern request or contact with a surveillance indicator with role 'noas'.",
    "Step 2: inspected non-empty JavaScript response to a NOAS-pattern request or NOAS-role host, or a response_inspected event graded suspicious or higher.",
    "Step 3: request to a malicious-classified indicator.",
    "All in the same tab or correlation id, in order, within the correlation window.",
  ],
  requiredCapabilities: ["request_metadata", "response_body_inspection"],
  references: BOTH,
  limitations: CORRELATION_LIMITATIONS,
  falsePositiveConsiderations: [
    "A researcher or analyst visiting documented infrastructure on an ad-heavy page can produce the sequence by coincidence.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (!isStep3(event, ctx)) return [];
  const { s1, s2 } = findChain(event, ctx);
  if (!s1 || !s2) return [];
  const host = event.destination.hostname;
  const malicious = ctx
    .indicatorMatches(event)
    .filter((m) => m.indicator.classification === "malicious");
  // The documented NOAS servers are third-party ad infrastructure. When step 1 is the page's
  // own host, the pattern is more likely an unrelated endpoint or a page trying to trigger
  // alerts, so the priority is lowered while the evidence is still recorded.
  const firstPartyStart = isFirstPartyStep(s1);
  return [
    buildDetection(definition, ctx, {
      subject: `${event.tabId ?? event.correlationId ?? ""}|${host}`,
      ...(firstPartyStart ? { severity: "elevated" as const, confidence: "low" as const } : {}),
      confidenceRationale: firstPartyStart
        ? "The three steps occurred in the documented order, but the ad-selection request went to the page's own host rather than third-party ad infrastructure; this weakens the match to the documented chain and could be deliberately staged by a page."
        : "All three steps were observed directly and occurred in the documented order. The relationships between them are partly inferred from tab and timing; temporal proximity does not prove causation, and nothing here shows that spyware executed.",
      summary:
        "A sequence of events consistent with the documented AdFection delivery chain was observed: ad-selection request, then a script response, then contact with infrastructure documented as malicious.",
      significance:
        "This ordering matches the delivery chain documented by Citizen Lab and Confiant. It is a high investigation priority, not confirmation that this device was targeted or that anything executed.",
      evidence: [
        {
          eventIds: [s1.eventId],
          observed: `Step 1: request to ${s1.destination.hostname} matching the NOAS/getAd selection pattern or a documented NOAS host.`,
          kind: "observed",
        },
        { eventIds: [s2.eventId], observed: `Step 2: ${step2Description(s2)}`, kind: "observed" },
        {
          eventIds: [event.eventId],
          observed: `Step 3: request to ${host}, documented as malicious infrastructure (${malicious.map((m) => m.indicator.id).join(", ")}).`,
          kind: "observed",
        },
        linkEvidence(s1, s2, "Link step 1 to step 2"),
        linkEvidence(s2, event, "Link step 2 to step 3"),
      ],
      events: [s1, s2, event],
      matchedIndicatorIds: [...ctx.indicatorMatches(s1), ...malicious].map((m) => m.indicator.id),
      subjectHostnames: [s1.destination.hostname, s2.destination.hostname, host],
      alternativeExplanations: [
        "The steps may be unrelated activity that happened to occur close together in one tab.",
        "A researcher or scanner may have visited the documented infrastructure deliberately.",
        "The domain in step 3 may have changed ownership since it was documented.",
      ],
      recommendedActions: [
        "Do not clear browser data yet; export the evidence bundle from AdTripwire first.",
        "Contact a digital-security helpline (for example Access Now's Digital Security Helpline or Amnesty Tech) and share the exported evidence.",
        "Keep the device's operating system and browser updated.",
      ],
    }),
  ];
}

export const rule: Rule = {
  definition,
  evaluate,
};
