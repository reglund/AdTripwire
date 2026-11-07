import type {
  Detection,
  NormalizedEvent,
  RuleDefinition,
  RuleDefinitionNb,
} from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { buildDetection } from "./common.js";
import {
  PAGE_LIMITATIONS,
  PAGE_LIMITATIONS_NB,
  isSubFrame,
  pageSignalOf,
  signalFrameHost,
} from "./page-common.js";

const NB: RuleDefinitionNb = {
  name: "Melding mellom vinduer med den dokumenterte SDK-ready-typen",
  description:
    "Nettsidesensoren (valgfri) observerte en melding mellom vinduer med typen «analytics_sdk_ready», strengen som er spesifikk for den dokumenterte AdFection-leverings-SDK-en, i en underramme. Generelle typede meldinger (postmessage_wildcard_like) gir ingen oppdagelse; de blir liggende i korrelasjonsvinduet bare som støtte.",
  confidenceBasis:
    "Høy for SDK-ready-typen i en underramme: strengen er spesifikk for den dokumenterte SDK-en, og meldingen ble observert direkte i stedet for utledet fra skripttekst. Middels i toppdokumentet (den dokumenterte SDK-en kjørte i annonserammer); lav for en melding fra samme opprinnelse.",
  limitations: [
    ...PAGE_LIMITATIONS_NB,
    "Bare meldingstypen kontrolleres; meldingens opprinnelse, mål og innhold lagres ikke.",
  ],
  falsePositiveConsiderations: [
    "En side som omtaler eller gjengir den dokumenterte SDK-en kan sende den samme meldingstypen.",
  ],
};

export const definition: RuleDefinition = {
  id: "page.sdk_ready_message",
  name: "Cross-window message carrying the documented SDK ready type",
  version: "1.2.0",
  description:
    "The opt-in page sensor observed a cross-window message whose type is 'analytics_sdk_ready', the string specific to the documented AdFection delivery SDK, in a sub-frame. Generic typed messages (postmessage_wildcard_like) produce no detection; they remain in the correlation window as corroboration only.",
  category: "javascript_technique",
  severity: "elevated",
  confidence: "high",
  confidenceBasis:
    "High for the SDK ready type in a sub-frame: the string is specific to the documented SDK and the message was observed directly rather than inferred from script text. Medium in the top document (the documented SDK ran in ad frames); low for a same-origin message.",
  requiredEvidence: [
    "page_signal event of kind postmessage_sdk_ready from another origin (sub-frame for elevated); same-origin (crossOrigin false) is informational. postmessage_wildcard_like never produces a detection.",
  ],
  requiredCapabilities: ["page_signals"],
  references: BOTH,
  limitations: [
    ...PAGE_LIMITATIONS,
    "Only the message type is checked; the message origin, target and payload are not retained.",
  ],
  falsePositiveConsiderations: [
    "A page that discusses or replays the documented SDK could post the same message type.",
  ],
  nb: NB,
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  // Generic typed cross-origin messages (postmessage_wildcard_like) are ubiquitous (benign run
  // 2026-11-02: sign-in and ad frames); they stay in the window as corroboration only.
  const p = pageSignalOf(event, "postmessage_sdk_ready");
  if (!p) return [];
  const host = signalFrameHost(event);
  if (p.crossOrigin === false) {
    // Sent by the frame's own origin: the sensor cannot tell this apart from a page
    // referencing the string itself, so it is context only.
    return [
      buildDetection(definition, ctx, {
        subject: `${host}|sdk_ready_same_origin`,
        severity: "informational",
        confidence: "low",
        confidenceRationale:
          "The message came from the frame's own origin rather than from another frame, unlike the documented cross-frame SDK announcement.",
        summary: `A frame on ${host} posted a same-origin message with the 'analytics_sdk_ready' type documented for the AdFection delivery SDK.`,
        significance:
          "The documented SDK announced readiness to its embedding frame across origins. A same-origin message with this type is recorded as context only.",
        evidence: [
          {
            eventIds: [event.eventId],
            observed: `The page sensor observed a same-origin message of type 'analytics_sdk_ready' on ${host}.`,
            kind: "observed",
          },
        ],
        events: [event],
        subjectHostnames: [host],
        alternativeExplanations: [
          "A page or test harness reusing the documented message type within its own origin.",
        ],
        recommendedActions: [
          "No action is needed unless other detections occurred in the same frame.",
        ],
        nb: {
          confidenceRationale:
            "Meldingen kom fra rammens egen opprinnelse og ikke fra en annen ramme, i motsetning til den dokumenterte SDK-kunngjøringen mellom rammer.",
          summary: `En ramme på ${host} sendte en melding fra samme opprinnelse med typen «analytics_sdk_ready» som er dokumentert for AdFection-leverings-SDK-en.`,
          significance:
            "Den dokumenterte SDK-en meldte at den var klar til rammen som bygde den inn, på tvers av opprinnelser. En melding fra samme opprinnelse med denne typen registreres bare som kontekst.",
          alternativeExplanations: [
            "En side eller testrigg som gjenbruker den dokumenterte meldingstypen innenfor sin egen opprinnelse.",
          ],
          recommendedActions: [
            "Ingen tiltak er nødvendig med mindre andre oppdagelser skjedde i samme ramme.",
          ],
        },
      }),
    ];
  }
  const sub = isSubFrame(event);
  return [
    buildDetection(definition, ctx, {
      subject: `${host}|sdk_ready`,
      severity: sub ? "elevated" : "suspicious",
      confidence: sub ? "high" : "medium",
      confidenceRationale: sub
        ? "The message type is a string specific to the documented SDK and was observed directly in a sub-frame. That establishes the SDK message was sent, not what the SDK went on to do."
        : "The message type is specific to the documented SDK, but it was observed in the top-level document, whereas the documented SDK ran inside ad frames.",
      summary: `A frame on ${host} exchanged a cross-window message with the 'analytics_sdk_ready' type documented for the AdFection delivery SDK.`,
      significance:
        "In the documented chain the delivery SDK announced readiness with this message before loading further code. Observing it indicates the SDK, or something imitating it, ran in this frame; it does not show that anything further was delivered.",
      evidence: [
        {
          eventIds: [event.eventId],
          observed: `The page sensor observed a message of type 'analytics_sdk_ready' in ${sub ? "a sub-frame" : "the top-level document"} on ${host}.`,
          kind: "observed",
        },
      ],
      events: [event],
      subjectHostnames: [host],
      alternativeExplanations: [
        "A research or test page reproducing the documented SDK message.",
        "Another script that happens to reuse the same message type.",
      ],
      recommendedActions: [
        "Look for NOAS/getAd requests, inserted frames or contact with documented infrastructure in the same tab.",
        "Export the evidence bundle before clearing browser data.",
      ],
      nb: {
        confidenceRationale: sub
          ? "Meldingstypen er en streng som er spesifikk for den dokumenterte SDK-en, og den ble observert direkte i en underramme. Det slår fast at SDK-meldingen ble sendt, ikke hva SDK-en gjorde etterpå."
          : "Meldingstypen er spesifikk for den dokumenterte SDK-en, men ble observert i toppnivådokumentet, mens den dokumenterte SDK-en kjørte i annonserammer.",
        summary: `En ramme på ${host} utvekslet en melding mellom vinduer med typen «analytics_sdk_ready» som er dokumentert for AdFection-leverings-SDK-en.`,
        significance:
          "I den dokumenterte kjeden meldte leverings-SDK-en at den var klar med denne meldingen før den lastet mer kode. At den observeres, kan tyde på at SDK-en, eller noe som etterligner den, kjørte i denne rammen; det viser ikke at noe mer ble levert.",
        alternativeExplanations: [
          "En forsknings- eller testside som gjenskaper den dokumenterte SDK-meldingen.",
          "Et annet skript som tilfeldigvis bruker den samme meldingstypen.",
        ],
        recommendedActions: [
          "Se etter NOAS/getAd-forespørsler, innsatte rammer eller kontakt med dokumentert infrastruktur i samme fane.",
          "Eksporter bevispakken før du tømmer nettleserdata.",
        ],
      },
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
