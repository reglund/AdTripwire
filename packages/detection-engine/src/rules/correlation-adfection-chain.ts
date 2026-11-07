import type {
  Detection,
  EvidenceItem,
  NormalizedEvent,
  RuleDefinition,
  RuleDefinitionNb,
} from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { SEVERITY_RANK, buildDetection, lowerSeverity } from "./common.js";
import {
  CORRELATION_LIMITATIONS,
  CORRELATION_LIMITATIONS_NB,
  findChain,
  findChainAroundSignal,
  pageSignalStep2Strength,
  type ChainScope,
  isStep3,
  linkEvidence,
  scopeEvidence,
  scopeLimitations,
  step2Description,
  isFirstPartyStep,
} from "./correlation-common.js";

const NB: RuleDefinitionNb = {
  name: "Sekvens som samsvarer med den dokumenterte AdFection-leveringskjeden",
  description:
    "Innenfor korrelasjonsvinduet og samme rammehierarki: (1) en forespørsel med NOAS/getAd-mønster eller kontakt med NOAS-indikator, deretter (2) et JavaScript-svar med innhold på den, et mistenkelig inspisert skript eller (med den valgfrie nettsidesensoren) en observert iframe eller skriptinnsetting på tvers av opprinnelser, deretter (3) kontakt med infrastruktur dokumentert som skadelig. En sekvens som bare finnes på tvers av urelaterte rammer i én fane, eller uten rammehierarki, rapporteres ett nivå lavere.",
  confidenceBasis:
    "Middels: hvert trinn er observert direkte og rekkefølgen samsvarer med den dokumenterte kjeden, men koblingene mellom trinnene er utledet fra rammehierarki (eller fane) og tid, og tidsmessig nærhet beviser ikke årsak.",
  limitations: CORRELATION_LIMITATIONS_NB,
  falsePositiveConsiderations: [
    "En forsker eller analytiker som besøker dokumentert infrastruktur på en side med mye annonser kan gi sekvensen ved en tilfeldighet.",
  ],
};

export const definition: RuleDefinition = {
  id: "correlation.adfection_chain",
  name: "Sequence consistent with the documented AdFection delivery chain",
  version: "1.3.0",
  description:
    "Within the correlation window and the same frame lineage: (1) a NOAS/getAd-pattern request or NOAS indicator contact, then (2) a non-empty JavaScript response for it, a suspicious inspected script, or (with the opt-in page sensor) an observed cross-origin hidden-iframe or script insertion, then (3) contact with infrastructure documented as malicious. A sequence found only across unrelated frames of one tab, or without frame ancestry, is reported one level lower.",
  category: "temporal_correlation",
  severity: "high_priority",
  confidence: "medium",
  confidenceBasis:
    "Medium: each step is observed directly and the order matches the documented chain, but the links between steps are inferred from frame lineage (or tab) and timing, and temporal proximity does not prove causation.",
  requiredEvidence: [
    "Step 1: NOAS/getAd-pattern request or contact with a surveillance indicator with role 'noas'.",
    "Step 2: inspected non-empty JavaScript response to a NOAS-pattern request or NOAS-role host, a response_inspected event graded suspicious or higher, or a page signal in the same frame lineage: a cross-origin hidden_iframe_inserted, or a script_inserted whose target matches a surveillance/malicious indicator (a plain cross-origin script_inserted lowers the chain one level; any page-signal step 2 caps the chain at elevated unless step 1 is a documented NOAS-role host). Evaluated on step 3, and again when a page-signal step 2 arrives late.",
    "Step 3: request to a malicious-classified indicator.",
    "All in the same frame lineage, in order, within the correlation window (same tab only: one severity level lower).",
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: CORRELATION_LIMITATIONS,
  falsePositiveConsiderations: [
    "A researcher or analyst visiting documented infrastructure on an ad-heavy page can produce the sequence by coincidence.",
  ],
  nb: NB,
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  // Late page-signal step 2: the signal arrives after the step-3 request it preceded.
  if (event.eventType === "page_signal") {
    if (pageSignalStep2Strength(event, ctx) === null) return [];
    const found = findChainAroundSignal(event, ctx);
    if (!found) return [];
    return [chainDetection(ctx, found.s1, event, found.s3, "lineage", false)];
  }
  if (!isStep3(event, ctx)) return [];
  const { s1, s2, scope, ancestryUnavailable } = findChain(event, ctx, { pageSignalStep2: true });
  if (!s1 || !s2) return [];
  return [chainDetection(ctx, s1, s2, event, scope, ancestryUnavailable)];
}

/**
 * Build the chain detection. `event` is step 3; the dedup subject depends only on step 3
 * (tab and host), so the step-3-triggered and the late-signal-triggered forms dedup/escalate.
 */
function chainDetection(
  ctx: RuleContext,
  s1: NormalizedEvent,
  s2: NormalizedEvent,
  event: NormalizedEvent,
  scope: ChainScope,
  ancestryUnavailable: boolean,
): Detection {
  const host = event.destination.hostname;
  const malicious = ctx
    .indicatorMatches(event)
    .filter((m) => m.indicator.classification === "malicious");
  // The documented NOAS servers are third-party ad infrastructure. When step 1 is the page's
  // own host, the pattern is more likely an unrelated endpoint or a page trying to trigger
  // alerts, so the priority is lowered while the evidence is still recorded.
  const firstPartyStart = isFirstPartyStep(s1);
  const base = firstPartyStart ? "elevated" : "high_priority";
  // A plain cross-origin script insertion is what nearly every ad frame does: as the only step 2
  // it lowers the chain one level.
  const weakStep2 = pageSignalStep2Strength(s2, ctx) === "weak";
  let severity = scope === "lineage" ? base : lowerSeverity(base);
  if (weakStep2) severity = lowerSeverity(severity);
  // A page-signal step 2 can be staged entirely by a hostile third-party frame (its own
  // "/getAd?idfa=" request, a 1x1 frame, an <img> to documented infrastructure). Unless step 1
  // is a documented NOAS host, such a chain is capped at elevated.
  const documentedNoas = ctx
    .indicatorMatches(s1)
    .some((m) => m.indicator.classification === "surveillance" && m.indicator.role === "noas");
  const pageCapped =
    s2.eventType === "page_signal" &&
    !documentedNoas &&
    SEVERITY_RANK[severity] > SEVERITY_RANK.elevated;
  if (pageCapped) severity = "elevated";
  const weakEvidence: EvidenceItem[] = weakStep2
    ? [
        {
          eventIds: [s2.eventId],
          observed:
            "Step 2 is only a cross-origin script insertion, which ordinary ad frames perform routinely; its target is not documented infrastructure, so the priority is lowered one level.",
          kind: "inferred",
        },
      ]
    : [];
  return buildDetection(definition, ctx, {
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
      ...weakEvidence,
      ...(pageCapped
        ? [
            {
              eventIds: [s1.eventId, s2.eventId],
              observed:
                "Step 2 is an in-page signal and step 1 matched only the /getAd request pattern, not a documented NOAS host; a single frame could stage this sequence itself, so the priority is capped at elevated.",
              kind: "inferred" as const,
            },
          ]
        : []),
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
    nb: {
      confidenceRationale: firstPartyStart
        ? "De tre trinnene skjedde i den dokumenterte rekkefølgen, men forespørselen om annonseutvelgelse gikk til sidens egen vert i stedet for tredjeparts annonseinfrastruktur; dette svekker samsvaret med den dokumenterte kjeden og kan være iscenesatt av en side med vilje."
        : scope === "lineage"
          ? "Alle tre trinnene ble observert direkte, i den dokumenterte rekkefølgen og innenfor ett rammehierarki. Forholdet mellom dem er delvis utledet fra tid; tidsmessig nærhet beviser ikke årsak, og ingenting her viser at spionprogramvare ble kjørt."
          : "Alle tre trinnene ble observert direkte og skjedde i den dokumenterte rekkefølgen, men de kunne bare kobles sammen via fane og tid, ikke via rammehierarki, så prioriteten er satt ett nivå lavere. Tidsmessig nærhet beviser ikke årsak, og ingenting her viser at spionprogramvare ble kjørt.",
      summary:
        "Observert en sekvens av hendelser som samsvarer med den dokumenterte AdFection-leveringskjeden: forespørsel om annonseutvelgelse, deretter et skriptsvar, deretter kontakt med infrastruktur dokumentert som skadelig.",
      significance:
        "Denne rekkefølgen samsvarer med leveringskjeden dokumentert av Citizen Lab og Confiant. Det er høy undersøkelsesprioritet, ikke en bekreftelse på at denne enheten var målrettet eller at noe ble kjørt.",
      alternativeExplanations: [
        "Trinnene kan være urelatert aktivitet som tilfeldigvis skjedde tett på hverandre i én fane.",
        "En forsker eller skanner kan ha besøkt den dokumenterte infrastrukturen med vilje.",
        "Domenet i trinn 3 kan ha skiftet eier etter at det ble dokumentert.",
      ],
      recommendedActions: [
        "Ikke tøm nettleserdata ennå; eksporter først bevispakken fra AdTripwire.",
        "Ta kontakt med en hjelpetjeneste for digital sikkerhet (for eksempel Access Now Digital Security Helpline eller Amnesty Tech) og del de eksporterte bevisene.",
        "Hold enhetens operativsystem og nettleser oppdatert.",
      ],
    },
  });
}

export const rule: Rule = {
  definition,
  // Step 2 can come from response inspection or from the opt-in page sensor.
  anyOfCapabilities: ["response_body_inspection", "page_signals"],
  evaluate,
};
