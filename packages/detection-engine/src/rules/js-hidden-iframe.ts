import { BOTH } from "./references.js";
import { jsDefinition, makeJsRule } from "./js-common.js";

export const definition = jsDefinition({
  id: "js.hidden_iframe_injection",
  name: "Script creates a 1x1 iframe",
  description:
    "An inspected script creates an iframe and uses 1x1-pixel dimensions, the hidden-frame injection documented for selected devices.",
  severity: "suspicious",
  confidence: "low",
  confidenceBasis:
    "Low with iframe creation and 1x1 sizing only; medium when the script also injects further script elements, as documented.",
  requiredEvidence: [
    "Markers js.iframe_create AND js.iframe_1x1; js.script_inject raises confidence.",
  ],
  references: BOTH,
  falsePositiveConsiderations: [
    "Tracking pixels, ad-verification and consent tools commonly use invisible 1x1 iframes.",
  ],
  nb: {
    name: "Skript lager en 1x1-iframe",
    description:
      "Et inspisert skript lager en iframe og bruker dimensjoner på 1x1 piksel, den skjulte rammeinnsettingen som er dokumentert for enheter som ble valgt ut.",
    confidenceBasis:
      "Lav med bare oppretting av iframe og 1x1-størrelse; middels når skriptet også setter inn flere skriptelementer, som dokumentert.",
    falsePositiveConsiderations: [
      "Sporingspiksler, annonseverifisering og samtykkeverktøy bruker ofte usynlige 1x1-iframes.",
    ],
  },
});

export const rule = makeJsRule(definition, {
  summary: () =>
    "An inspected script creates a 1x1 iframe, a technique used to load hidden content.",
  significance:
    "In the documented chain, code returned to selected devices injected a 1x1 iframe that loaded the next stage.",
  confidenceRationale: (o) =>
    o.confidence === "medium"
      ? "Iframe creation, 1x1 sizing and dynamic script injection all appear, matching the documented injected code."
      : "Iframe creation with 1x1 sizing is also common in ordinary ad tracking.",
  alternativeExplanations: [
    "An ordinary tracking pixel or ad-verification frame.",
    "A consent-management or analytics helper frame.",
  ],
  nb: {
    summary: () =>
      "Et inspisert skript lager en 1x1-iframe, en teknikk som brukes for å laste skjult innhold.",
    significance:
      "I den dokumenterte kjeden satte kode som ble returnert til enheter som ble valgt ut inn en 1x1-iframe som lastet neste trinn.",
    confidenceRationale: (o) =>
      o.confidence === "medium"
        ? "Oppretting av iframe, 1x1-størrelse og dynamisk innsetting av skript forekommer alle, i samsvar med den dokumenterte injiserte koden."
        : "Oppretting av iframe med 1x1-størrelse er også vanlig i ordinær annonsesporing.",
    alternativeExplanations: [
      "En vanlig sporingspiksel eller annonseverifiserings-frame.",
      "En hjelperamme for samtykkehåndtering eller analyse.",
    ],
  },
});
export const evaluate = rule.evaluate;
