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
  name: "Tredjepartsskript satt inn etter innlasting",
  description:
    "Nettsidesensoren (valgfri) observerte et skriptelement fra en annen opprinnelse som ble satt inn etter at rammen var lastet, etter en forespørsel med NOAS/getAd-mønster i samme rammehierarki. Uten denne forespørselen gis ingen oppdagelse (hendelsen blir liggende i vinduet for korrelasjon), fordi sene tredjepartsskript er vanlig oppførsel for annonsekoder.",
  confidenceBasis:
    "Ingen oppdagelse alene: sen innsetting av skript er slik de fleste annonsekoder fungerer. Middels med NOAS-kontakt i samme rammehierarki, i samsvar med det dokumenterte trinnet der enheter som ble valgt ut fikk kode som lastet flere skript.",
  limitations: PAGE_LIMITATIONS_NB,
  falsePositiveConsiderations: [
    ...PAGE_FALSE_POSITIVES_NB,
    "Tagghåndteringssystemer og header bidding-moduler setter inn mange tredjepartsskript etter innlasting.",
  ],
};

export const definition: RuleDefinition = {
  id: "page.late_third_party_script",
  name: "Third-party script inserted after load",
  version: "1.1.0",
  description:
    "The opt-in page sensor observed a cross-origin script element inserted after the frame loaded after a NOAS/getAd-pattern request in the same frame lineage. Without that request no detection is produced (the event stays in the window for correlation), because late third-party scripts are ordinary ad-tag behaviour.",
  category: "ad_delivery_behaviour",
  severity: "suspicious",
  confidence: "medium",
  confidenceBasis:
    "No detection on its own: late script insertion is how most ad tags work. Medium with a NOAS contact in the same frame lineage, matching the documented step where selected devices received code that loaded further scripts.",
  requiredEvidence: [
    "page_signal of kind script_inserted with crossOrigin true.",
    "A NOAS/getAd-pattern request or NOAS indicator contact in the same frame lineage within the correlation window.",
  ],
  requiredCapabilities: ["page_signals"],
  references: BOTH,
  limitations: PAGE_LIMITATIONS,
  falsePositiveConsiderations: [
    ...PAGE_FALSE_POSITIVES,
    "Tag managers and header-bidding wrappers insert many third-party scripts after load.",
  ],
  nb: NB,
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  const p = pageSignalOf(event, "script_inserted");
  if (!p || p.crossOrigin !== true) return [];
  const host = signalFrameHost(event);
  const target = p.targetHostname;
  const noas = lineageNoasContact(event, ctx);
  // Benign run 2026-11-02: late third-party scripts alone are routine; event only.
  if (!noas) return [];
  const observed = {
    eventIds: [event.eventId],
    observed: `The page sensor observed a third-party script${target ? ` from ${target}` : ""} inserted${timing(p)} in a frame on ${host}.`,
    kind: "observed" as const,
  };
  return [
    buildDetection(definition, ctx, {
      subject: `${event.tabId ?? ""}|${host}|${target ?? ""}`,
      severity: "suspicious",
      confidence: "medium",
      confidenceRationale:
        "The script insertion was observed directly and followed an ad-selection request in the same frame lineage; the link is inferred from lineage and timing.",
      summary:
        "An ad-selection request was followed in the same frame lineage by insertion of a third-party script.",
      significance:
        "In the documented chain, code returned to selected devices loaded further scripts toward validator infrastructure. On its own, late script insertion is very common.",
      evidence: [
        {
          eventIds: [noas.eventId],
          observed: `Earlier ad-selection (NOAS/getAd) request to ${noas.destination.hostname} in the same frame lineage.`,
          kind: "observed",
        },
        observed,
        linkEvidence(noas, event, "Link from ad-selection request to script insertion", "lineage"),
      ],
      events: [noas, event],
      matchedIndicatorIds: ctx.indicatorMatches(noas).map((m) => m.indicator.id),
      subjectHostnames: [host, ...(target ? [target] : []), noas.destination.hostname],
      alternativeExplanations: [
        "An ordinary ad tag, tag manager or header-bidding wrapper loading its components.",
      ],
      nb: {
        confidenceRationale:
          "Innsettingen av skriptet ble observert direkte og fulgte en forespørsel om annonseutvelgelse i samme rammehierarki; koblingen er utledet fra hierarki og tid.",
        summary:
          "En forespørsel om annonseutvelgelse ble i samme rammehierarki fulgt av innsetting av et tredjepartsskript.",
        significance:
          "I den dokumenterte kjeden lastet kode som ble returnert til enheter som ble valgt ut flere skript mot valideringsinfrastruktur. Alene er sen innsetting av skript svært vanlig.",
        alternativeExplanations: [
          "En vanlig annonsekode, tagghåndteringssystem eller header bidding-modul som laster sine komponenter.",
        ],
      },
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
