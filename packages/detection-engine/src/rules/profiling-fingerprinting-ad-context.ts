import type {
  Detection,
  NormalizedEvent,
  RuleDefinition,
  RuleDefinitionNb,
} from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH, MDN_URL_CLASSIFICATION } from "./references.js";
import { buildDetection, hasAnyFlag, isFirstObservation, relatedEvents } from "./common.js";
import { isNoasContact } from "./noas.js";
import { lineageRelation } from "./correlation-common.js";

const NB: RuleDefinitionNb = {
  name: "Forespørsel klassifisert som fingeravtrykkssporing nær dokumentert annonseinfrastruktur",
  description:
    "Firefox klassifiserte en forespørsel som fingeravtrykkssporing i nettleseren, og samme rammehierarki (foretrukket) eller fane kontaktet NOAS/getAd-mønster eller dokumentert infrastruktur innenfor korrelasjonsvinduet.",
  confidenceBasis:
    "Lav: Firefox sin liste over fingeravtrykkssporing er bred, og sammenfall i tid i en fane viser ikke at de to henger sammen. Regelen styrker bare andre signaler.",
  limitations: [
    "Firefox sin klassifisering er listebasert og gjenspeiler bare forespørselens vert, ikke skriptets oppførsel.",
  ],
  falsePositiveConsiderations: [
    "Mange ordinære annonse- og svindelforebyggende skript er klassifisert som fingeravtrykkssporing.",
  ],
};

export const definition: RuleDefinition = {
  id: "profiling.fingerprinting_classified_in_ad_context",
  name: "Fingerprinting-classified request near documented ad infrastructure",
  version: "1.1.0",
  description:
    "Firefox classified a request as fingerprinting, and the same frame lineage (preferred) or tab contacted NOAS/getAd-pattern or documented infrastructure within the correlation window.",
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
  nb: NB,
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (!hasAnyFlag(event, "fingerprinting")) return [];
  if (!isFirstObservation(event, ctx) || event.eventType === "request_error") return [];
  const isAnchor = (e: NormalizedEvent): boolean =>
    isNoasContact(e, ctx) ||
    ctx
      .indicatorMatches(e)
      .some(
        (m) =>
          m.indicator.classification === "malicious" ||
          m.indicator.classification === "surveillance",
      );
  const prior = relatedEvents(event, ctx);
  // Prefer an anchor in the same frame lineage; fall back to the tab.
  let anchor = prior.find((e) => isAnchor(e) && lineageRelation(e, event) === "related");
  const lineage = anchor !== undefined;
  anchor ??= prior.find(isAnchor);
  if (!anchor) return [];
  const host = event.destination.hostname;
  return [
    buildDetection(definition, ctx, {
      subject: `${host}|${event.tabId ?? event.correlationId ?? ""}`,
      confidenceRationale: lineage
        ? "Both observations are direct and occurred in the same frame lineage, but the link between them is inferred from lineage and time only."
        : "Both observations are direct, but the link between them is inferred from tab and time only (not the same frame lineage).",
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
          observed: lineage
            ? "The two requests are assumed related because they share a frame lineage and time window."
            : "The two requests are assumed related only because they share a tab and time window; they were not in the same frame lineage, or lineage was unavailable.",
          kind: "inferred",
        },
      ],
      events: [anchor, event],
      subjectHostnames: [host, anchor.destination.hostname],
      alternativeExplanations: [
        "Unrelated anti-fraud or analytics fingerprinting on the same page.",
        "Coincidental timing on an ad-heavy page.",
      ],
      nb: {
        confidenceRationale: lineage
          ? "Begge observasjonene er direkte og skjedde i samme rammehierarki, men koblingen mellom dem er utledet bare fra hierarki og tid."
          : "Begge observasjonene er direkte, men koblingen mellom dem er utledet bare fra fane og tid (ikke samme rammehierarki).",
        summary:
          "En forespørsel klassifisert som fingeravtrykkssporing skjedde i samme fane som kontakt med dokumentert infrastruktur for annonseutvelgelse.",
        significance:
          "Den dokumenterte operasjonen profilerte enheter før den bestemte om den skulle levere mer kode. Dette sammenfallet styrker, men fastslår ikke, slik profilering.",
        alternativeExplanations: [
          "Urelatert fingeravtrykkssporing i nettleseren til svindelforebygging eller analyse på samme side.",
          "Tilfeldig sammenfall i tid på en side med mye annonser.",
        ],
      },
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
