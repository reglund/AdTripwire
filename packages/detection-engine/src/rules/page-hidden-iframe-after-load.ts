import type {
  Detection,
  NormalizedEvent,
  RuleDefinition,
  RuleDefinitionNb,
} from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { buildDetection } from "./common.js";
import { linkEvidence } from "./correlation-common.js";
import {
  PAGE_FALSE_POSITIVES,
  PAGE_FALSE_POSITIVES_NB,
  PAGE_LIMITATIONS,
  PAGE_LIMITATIONS_NB,
  lineageNoasContact,
  pageSignalOf,
  signalFrameHost,
  timing,
} from "./page-common.js";

const NB: RuleDefinitionNb = {
  name: "Skjult iframe fra annen opprinnelse satt inn etter innlasting",
  description:
    "Nettsidesensoren (valgfri) observerte en skjult (høyst 2x2 px eller display:none) iframe fra en annen opprinnelse som ble satt inn etter at rammen var lastet. Etter en forespørsel med NOAS/getAd-mønster i samme rammehierarki er dette den observerte formen av innlastingsrammen som responsinspeksjon bare kan utlede.",
  confidenceBasis:
    "Lav alene: usynlige rammer for måling og synkronisering er vanlige. Middels med NOAS-kontakt i samme rammehierarki, fordi innsettingen er observert direkte og samsvarer med det dokumenterte innlastingstrinnet; koblingen til forespørselen er fortsatt utledet fra hierarki og tid.",
  limitations: PAGE_LIMITATIONS_NB,
  falsePositiveConsiderations: [
    ...PAGE_FALSE_POSITIVES_NB,
    "Rammer for ID-synkronisering via informasjonskapsler og synlighetsmåling er skjulte rammer fra andre opprinnelser av design.",
  ],
};

export const definition: RuleDefinition = {
  id: "page.hidden_iframe_after_load",
  name: "Hidden cross-origin iframe inserted after load",
  version: "1.0.0",
  description:
    "The opt-in page sensor observed a hidden (at most 2x2 px or display:none) cross-origin iframe inserted after the frame loaded. After a NOAS/getAd-pattern request in the same frame lineage, this is the observed form of the loader frame that response inspection can only infer.",
  category: "ad_delivery_behaviour",
  severity: "elevated",
  confidence: "medium",
  confidenceBasis:
    "Low on its own: invisible measurement and sync frames are common. Medium with a NOAS contact in the same frame lineage, because the insertion is observed directly and matches the documented loader step; the link to the request is still inferred from lineage and timing.",
  requiredEvidence: [
    "page_signal of kind hidden_iframe_inserted with crossOrigin true.",
    "For elevated: a NOAS/getAd-pattern request or NOAS indicator contact in the same frame lineage within the correlation window.",
  ],
  requiredCapabilities: ["page_signals"],
  references: BOTH,
  limitations: PAGE_LIMITATIONS,
  falsePositiveConsiderations: [
    ...PAGE_FALSE_POSITIVES,
    "Cookie-sync and viewability frames are hidden cross-origin frames by design.",
  ],
  nb: NB,
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  const p = pageSignalOf(event, "hidden_iframe_inserted");
  if (!p || p.crossOrigin !== true) return [];
  const host = signalFrameHost(event);
  const target = p.targetHostname;
  const noas = lineageNoasContact(event, ctx);
  const evidence = [
    {
      eventIds: [event.eventId],
      observed: `The page sensor observed a hidden cross-origin iframe${target ? ` targeting ${target}` : ""} inserted${timing(p)} in a frame on ${host}.`,
      kind: "observed" as const,
    },
  ];
  if (noas) {
    evidence.unshift({
      eventIds: [noas.eventId],
      observed: `Earlier ad-selection (NOAS/getAd) request to ${noas.destination.hostname} in the same frame lineage.`,
      kind: "observed" as const,
    });
  }
  return [
    buildDetection(definition, ctx, {
      subject: `${event.tabId ?? ""}|${host}|${target ?? ""}`,
      severity: noas ? "elevated" : "suspicious",
      confidence: noas ? "medium" : "low",
      confidenceRationale: noas
        ? "The hidden frame insertion was observed directly and followed an ad-selection request in the same frame lineage; the link between the two is inferred from lineage and timing."
        : "A hidden cross-origin frame was observed, but no ad-selection request preceded it in the same frame lineage, and such frames are common in ordinary advertising.",
      summary: noas
        ? "An ad-selection request was followed in the same frame lineage by insertion of a hidden cross-origin iframe."
        : "A hidden cross-origin iframe was inserted after load.",
      significance:
        "In the documented chain, selected devices received code that inserted a 1x1 frame to load the next stage. A hidden frame alone is common; together with a preceding ad-selection request it matches that step.",
      evidence: noas
        ? [
            ...evidence,
            linkEvidence(
              noas,
              event,
              "Link from ad-selection request to frame insertion",
              "lineage",
            ),
          ]
        : evidence,
      events: noas ? [noas, event] : [event],
      matchedIndicatorIds: noas ? ctx.indicatorMatches(noas).map((m) => m.indicator.id) : [],
      subjectHostnames: [
        host,
        ...(target ? [target] : []),
        ...(noas ? [noas.destination.hostname] : []),
      ],
      alternativeExplanations: [
        "A viewability, verification or cookie-sync frame inserted by an ordinary ad.",
        "A consent or login helper frame.",
      ],
      nb: {
        confidenceRationale: noas
          ? "Innsettingen av den skjulte rammen ble observert direkte og fulgte en forespørsel om annonseutvelgelse i samme rammehierarki; koblingen mellom de to er utledet fra hierarki og tid."
          : "En skjult ramme fra en annen opprinnelse ble observert, men ingen forespørsel om annonseutvelgelse gikk foran den i samme rammehierarki, og slike rammer er vanlige i vanlig annonsering.",
        summary: noas
          ? "En forespørsel om annonseutvelgelse ble i samme rammehierarki fulgt av innsetting av en skjult iframe fra en annen opprinnelse."
          : "En skjult iframe fra en annen opprinnelse ble satt inn etter innlasting.",
        significance:
          "I den dokumenterte kjeden fikk enheter som ble valgt ut kode som satte inn en 1x1-ramme for å laste neste trinn. En skjult ramme alene er vanlig; sammen med en foregående forespørsel om annonseutvelgelse samsvarer den med dette trinnet.",
        alternativeExplanations: [
          "En ramme for synlighetsmåling, verifisering eller ID-synkronisering via informasjonskapsler satt inn av en vanlig annonse.",
          "En hjelperamme for samtykke eller pålogging.",
        ],
      },
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
