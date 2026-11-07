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
  name: "Kontakt med dokumentert skadelig infrastruktur",
  description:
    "Det ble sendt en forespørsel til et vertsnavn som publisert forskning dokumenterer som kommando-og-kontroll-, validerings- eller utnyttelsesinfrastruktur (C2) for spionprogramvare.",
  confidenceBasis:
    "Tilliten arves fra indikatoroppføringen (hvor tydelig forskerne tilskrev infrastrukturen), ett steg lavere når alle treff er utenfor sitt dokumenterte gyldighetsvindu. Det er tillit til tilskrivingen av infrastrukturen, ikke til målrettet angrep eller til at spionprogramvare ble kjørt.",
  limitations: INFRA_LIMITATIONS_NB,
  falsePositiveConsiderations: INFRA_FALSE_POSITIVES_NB,
};

export const definition: RuleDefinition = {
  id: "known_infra.malicious_contact",
  name: "Contact with documented malicious infrastructure",
  version: "1.1.0",
  description:
    "A request was made to a hostname that published research documents as spyware command-and-control, validator, or exploit-delivery infrastructure.",
  category: "known_infrastructure",
  severity: "elevated",
  confidence: "high",
  confidenceBasis:
    "Confidence is inherited from the indicator record (how firmly researchers attributed the infrastructure), one step lower when every match is past its documented validity window. It is confidence in the infrastructure attribution, not in personal targeting or spyware execution.",
  requiredEvidence: [
    "Request destination hostname matching an enabled indicator classified 'malicious'.",
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: INFRA_LIMITATIONS,
  falsePositiveConsiderations: INFRA_FALSE_POSITIVES,
  nb: NB,
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  const matches = classMatches(contactMatches(event, ctx), "malicious");
  const top = matches[0];
  if (!top) return [];
  const host = event.destination.hostname;
  const expired = allExpired(matches);
  return [
    buildDetection(definition, ctx, {
      subject: host,
      confidence: expired ? lowerConfidence(top.indicator.confidence) : top.indicator.confidence,
      ...(expired ? { limitations: [...definition.limitations, EXPIRED_LIMITATION] } : {}),
      confidenceRationale: `Indicator ${top.indicator.id} is rated ${top.indicator.confidence} confidence by its source${expired ? ", lowered one step here because it is past its documented validity window" : ""}. Infrastructure attribution is not the same as personal targeting: this establishes only that the destination was documented as malicious infrastructure, not that anything was delivered to or executed on this device.`,
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
      nb: {
        ...(expired ? { limitations: [...NB.limitations, EXPIRED_LIMITATION_NB] } : {}),
        confidenceRationale: `Indikator ${top.indicator.id} er vurdert til ${CONFIDENCE_NB[top.indicator.confidence]} tillit av kilden${expired ? ", satt ett steg lavere her fordi den er utenfor sitt dokumenterte gyldighetsvindu" : ""}. Tilskriving av infrastruktur er ikke det samme som målrettet angrep: dette viser bare at målet var dokumentert som skadelig infrastruktur, ikke at noe ble levert til eller kjørt på denne enheten.`,
        summary:
          "Observert trafikk til infrastruktur som publisert forskning dokumenterer som knyttet til spionprogramvare.",
        significance:
          "Forskere har dokumentert denne infrastrukturen som del av en leverings- eller kontrollkjede for spionprogramvare. Én enkelt kontakt kan ha uskyldige årsaker, men bør gjennomgås sammen med annen aktivitet rundt.",
        alternativeExplanations: [
          "Domenet kan ha blitt registrert på nytt eller tatt i bruk til noe annet etter at det ble dokumentert.",
          "En lenkeforhåndsvisning, en sikkerhetsskanner eller en annen utvidelse kan ha forårsaket forespørselen.",
          "Du kan ha åpnet en lenke til domenet mens du leste om forskningen.",
        ],
        recommendedActions: [
          "Noter tidspunktet og siden du var på da dette skjedde.",
          "Se om andre oppdagelser i samme fane skjedde omtrent samtidig.",
          "Eksporter bevisene og ta kontakt med en hjelpetjeneste for digital sikkerhet hvis du tror du kan være et mål.",
        ],
      },
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
