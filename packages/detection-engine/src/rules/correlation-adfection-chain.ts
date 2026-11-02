import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { buildDetection, lowerSeverity } from "./common.js";
import {
  CORRELATION_LIMITATIONS,
  findChain,
  isStep3,
  linkEvidence,
  scopeEvidence,
  scopeLimitations,
  step2Description,
  isFirstPartyStep,
} from "./correlation-common.js";

export const definition: RuleDefinition = {
  id: "correlation.adfection_chain",
  name: "Sequence consistent with the documented AdFection delivery chain",
  version: "1.1.0",
  description:
    "Within the correlation window and the same frame lineage: (1) a NOAS/getAd-pattern request or NOAS indicator contact, then (2) a non-empty JavaScript response for it, a suspicious inspected script, or (with the opt-in page sensor) an observed cross-origin hidden-iframe or script insertion, then (3) contact with infrastructure documented as malicious. A sequence found only across unrelated frames of one tab, or without frame ancestry, is reported one level lower.",
  category: "temporal_correlation",
  severity: "high_priority",
  confidence: "medium",
  confidenceBasis:
    "Medium: each step is observed directly and the order matches the documented chain, but the links between steps are inferred from frame lineage (or tab) and timing, and temporal proximity does not prove causation.",
  requiredEvidence: [
    "Step 1: NOAS/getAd-pattern request or contact with a surveillance indicator with role 'noas'.",
    "Step 2: inspected non-empty JavaScript response to a NOAS-pattern request or NOAS-role host, a response_inspected event graded suspicious or higher, or a cross-origin hidden_iframe_inserted/script_inserted page signal in the same frame lineage.",
    "Step 3: request to a malicious-classified indicator.",
    "All in the same frame lineage, in order, within the correlation window (same tab only: one severity level lower).",
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: CORRELATION_LIMITATIONS,
  falsePositiveConsiderations: [
    "A researcher or analyst visiting documented infrastructure on an ad-heavy page can produce the sequence by coincidence.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (!isStep3(event, ctx)) return [];
  const { s1, s2, scope, ancestryUnavailable } = findChain(event, ctx, { pageSignalStep2: true });
  if (!s1 || !s2) return [];
  const host = event.destination.hostname;
  const malicious = ctx
    .indicatorMatches(event)
    .filter((m) => m.indicator.classification === "malicious");
  // The documented NOAS servers are third-party ad infrastructure. When step 1 is the page's
  // own host, the pattern is more likely an unrelated endpoint or a page trying to trigger
  // alerts, so the priority is lowered while the evidence is still recorded.
  const firstPartyStart = isFirstPartyStep(s1);
  const base = firstPartyStart ? "elevated" : "high_priority";
  const severity = scope === "lineage" ? base : lowerSeverity(base);
  return [
    buildDetection(definition, ctx, {
      subject: `${event.tabId ?? event.correlationId ?? ""}|${host}`,
      severity,
      ...(firstPartyStart ? { confidence: "low" as const } : {}),
      confidenceRationale: firstPartyStart
        ? "The three steps occurred in the documented order, but the ad-selection request went to the page's own host rather than third-party ad infrastructure; this weakens the match to the documented chain and could be deliberately staged by a page."
        : scope === "lineage"
          ? "All three steps were observed directly, in the documented order and within one frame lineage. The relationships between them are partly inferred from timing; temporal proximity does not prove causation, and nothing here shows that spyware executed."
          : "All three steps were observed directly and occurred in the documented order, but they could only be linked by tab and timing, not by frame lineage, so the priority is lowered one level. Temporal proximity does not prove causation, and nothing here shows that spyware executed.",
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
        linkEvidence(s1, s2, "Link step 1 to step 2", scope),
        linkEvidence(s2, event, "Link step 2 to step 3", scope),
        scopeEvidence(scope, ancestryUnavailable, [s1, s2, event]),
      ],
      extraLimitations: scopeLimitations(scope, ancestryUnavailable),
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
  // Step 2 can come from response inspection or from the opt-in page sensor.
  anyOfCapabilities: ["response_body_inspection", "page_signals"],
  evaluate,
};
