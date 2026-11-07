import type {
  Detection,
  NormalizedEvent,
  RuleDefinition,
  RuleDefinitionNb,
} from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { CONFIDENCE_NB, buildDetection, classMatches, lowerConfidence } from "./common.js";
import {
  EXPIRED_LIMITATION,
  EXPIRED_LIMITATION_NB,
  INFRA_FALSE_POSITIVES,
  INFRA_FALSE_POSITIVES_NB,
  allExpired,
  INFRA_LIMITATIONS,
  INFRA_LIMITATIONS_NB,
  contactMatches,
  describeMatch,
  indicatorReferences,
} from "./known-infra-common.js";

const NB: RuleDefinitionNb = {
  name: "Kontakt med dokumentert annonseinfrastruktur knyttet til overvåkingsoperasjonen",
  description:
    "Det ble sendt en forespørsel til annonse- eller sporingsinfrastruktur som publisert forskning knytter til AdFection-operasjonen. Kontakt med server for annonsevalg (NOAS) vurderes høyere enn kontakt med sporingsverter.",
  confidenceBasis:
    "Tilliten arves fra indikatoroppføringen (ett steg lavere når alle treff er utenfor sitt dokumenterte gyldighetsvindu) og gjelder bare tilskrivingen av infrastrukturen. Utløpte indikatorer løfter aldri alvorlighetsgraden over «mistenkelig». Kontakt med denne typen infrastruktur er vanlig eksponering og et svakt bevis for målrettet angrep.",
  limitations: INFRA_LIMITATIONS_NB,
  falsePositiveConsiderations: [
    ...INFRA_FALSE_POSITIVES_NB,
    "Verter for ID-synkronisering via informasjonskapsler og sporing av annonsevisninger kontaktes i svært stor skala under vanlig surfing.",
  ],
};

export const definition: RuleDefinition = {
  id: "known_infra.surveillance_contact",
  name: "Contact with documented surveillance-associated ad infrastructure",
  version: "1.1.0",
  description:
    "A request was made to advertising or tracking infrastructure that published research associates with the AdFection surveillance operation. Selection-server (NOAS) contact is rated higher than tracking contact.",
  category: "known_infrastructure",
  severity: "suspicious",
  confidence: "high",
  confidenceBasis:
    "Confidence is inherited from the indicator record (one step lower when every match is past its documented validity window) and reflects the infrastructure attribution only. Expired indicators never raise severity above suspicious. Contact with this kind of infrastructure is common exposure and is low-confidence evidence of personal targeting.",
  requiredEvidence: [
    "Request destination hostname matching an enabled indicator classified 'surveillance'.",
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: INFRA_LIMITATIONS,
  falsePositiveConsiderations: [
    ...INFRA_FALSE_POSITIVES,
    "Cookie-sync and impression-tracking hosts are contacted at very large scale during ordinary browsing.",
  ],
  nb: NB,
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  const all = contactMatches(event, ctx);
  if (classMatches(all, "malicious").length > 0) return []; // reported by the malicious rule
  const matches = classMatches(all, "surveillance");
  const top = matches[0];
  if (!top) return [];
  const host = event.destination.hostname;
  const expired = allExpired(matches);
  // An expired NOAS indicator does not raise severity: the host may have been reassigned.
  const isNoas = matches.some((m) => m.indicator.role === "noas" && m.validity !== "expired");
  const isTracking = !isNoas && matches.some((m) => m.indicator.role === "tracking");
  const severity = isNoas ? "elevated" : "suspicious";
  const summary = isNoas
    ? "Traffic to an ad-selection (NOAS/getAd) server documented in the AdFection investigation was observed."
    : isTracking
      ? "Traffic to ad-tracking infrastructure documented in the AdFection investigation was observed. This is very common exposure."
      : "Traffic to infrastructure documented in the AdFection investigation was observed.";
  const significance = isNoas
    ? "The documented selection servers decide per device whether to return anything. Contact indicates exposure to the selection infrastructure, not that this device was selected."
    : isTracking
      ? "This is very common exposure: documented tracking hosts are contacted at very large scale by ordinary ad traffic. It is not evidence of targeting on its own."
      : "This infrastructure was documented as part of the operator's ad-delivery footprint. Contact alone is exposure, not evidence of targeting.";
  const summaryNb = isNoas
    ? "Observert trafikk til en server for annonsevalg (NOAS/getAd) som er dokumentert i AdFection-undersøkelsen."
    : isTracking
      ? "Observert trafikk til annonsesporingsinfrastruktur som er dokumentert i AdFection-undersøkelsen. Dette er svært vanlig eksponering."
      : "Observert trafikk til infrastruktur som er dokumentert i AdFection-undersøkelsen.";
  const significanceNb = isNoas
    ? "De dokumenterte serverne for annonsevalg avgjør per enhet om de skal returnere noe. Kontakt viser eksponering mot infrastrukturen for annonsevalg, ikke at denne enheten ble valgt ut."
    : isTracking
      ? "Dette er svært vanlig eksponering: dokumenterte sporingsverter kontaktes i svært stor skala av vanlig annonsetrafikk. Det er ikke i seg selv bevis på målretting."
      : "Denne infrastrukturen er dokumentert som en del av operatørens annonseleveranse. Kontakt alene er eksponering, ikke bevis på målretting.";
  return [
    buildDetection(definition, ctx, {
      subject: host,
      severity,
      confidence: expired ? lowerConfidence(top.indicator.confidence) : top.indicator.confidence,
      ...(expired ? { limitations: [...definition.limitations, EXPIRED_LIMITATION] } : {}),
      confidenceRationale: `Indicator ${top.indicator.id} is rated ${top.indicator.confidence} confidence by its source${expired ? ", lowered one step here because it is past its documented validity window" : ""}. That is confidence in the infrastructure attribution; as evidence of personal targeting this contact is low confidence${isTracking ? " (very common exposure)" : ""}.`,
      summary,
      significance,
      evidence: matches.map((m) => ({
        eventIds: [event.eventId],
        observed: describeMatch(m),
        kind: "observed" as const,
      })),
      events: [event],
      matchedIndicatorIds: matches.map((m) => m.indicator.id),
      subjectHostnames: [host],
      alternativeExplanations: [
        "Ordinary programmatic advertising routes requests through many intermediaries, including this one.",
        "The page you visited may simply have carried an ad served through this network.",
      ],
      recommendedActions: [
        "Consider an ad or tracker blocker to reduce exposure to ad-delivery infrastructure.",
        "Look for follow-on detections (JavaScript responses, hidden frames, or malicious infrastructure) in the same tab.",
      ],
      references: indicatorReferences(matches, definition.references),
      nb: {
        ...(expired ? { limitations: [...NB.limitations, EXPIRED_LIMITATION_NB] } : {}),
        confidenceRationale: `Indikator ${top.indicator.id} er vurdert til ${CONFIDENCE_NB[top.indicator.confidence]} tillit av kilden${expired ? ", satt ett steg lavere her fordi den er utenfor sitt dokumenterte gyldighetsvindu" : ""}. Det er tillit til tilskrivingen av infrastrukturen; som bevis på målrettet angrep har denne kontakten lav tillit${isTracking ? " (svært vanlig eksponering)" : ""}.`,
        summary: summaryNb,
        significance: significanceNb,
        alternativeExplanations: [
          "Vanlig programmatisk annonsering sender forespørsler gjennom mange mellomledd, deriblant dette.",
          "Siden du besøkte kan rett og slett ha inneholdt en annonse levert gjennom dette nettverket.",
        ],
        recommendedActions: [
          "Vurder en annonse- eller sporingsblokkerer for å redusere eksponeringen mot annonseinfrastruktur.",
          "Se etter oppfølgende oppdagelser (JavaScript-svar, skjulte rammer eller skadelig infrastruktur) i samme fane.",
        ],
      },
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
