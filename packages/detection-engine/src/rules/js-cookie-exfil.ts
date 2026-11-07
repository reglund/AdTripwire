import { BOTH } from "./references.js";
import { jsDefinition, makeJsRule } from "./js-common.js";

export const definition = jsDefinition({
  id: "js.cookie_exfil_pattern",
  version: "1.1.0",
  name: "Script reads cookies and has an outbound beacon or the documented join separator",
  description:
    "An inspected script reads document.cookie and either joins values with the documented '~~~' separator or creates Image beacons, matching the documented first-party cookie collection.",
  severity: "elevated",
  confidence: "medium",
  confidenceBasis:
    "Medium: the '~~~' separator is specific to the documented code; Image beacons with cookie reads are also used by ordinary analytics, so the rule does not reach high.",
  requiredEvidence: [
    "Markers js.cookie_read AND (js.cookie_tilde_join OR js.image_beacon), co-located: js.colocated_cookie_exfil (first occurrences within 4000 characters).",
  ],
  references: BOTH,
  falsePositiveConsiderations: [
    "Analytics libraries read their own cookies and send Image beacons.",
  ],
  nb: {
    name: "Skript leser informasjonskapsler og har et utgående signal eller det dokumenterte skilletegnet",
    description:
      "Et inspisert skript leser document.cookie og enten slår sammen verdier med det dokumenterte skilletegnet «~~~» eller lager Image-signaler (beacons), i samsvar med den dokumenterte innsamlingen av førsteparts informasjonskapsler.",
    confidenceBasis:
      "Middels: skilletegnet «~~~» er spesifikt for den dokumenterte koden; Image-signaler sammen med lesing av informasjonskapsler brukes også av vanlig analyse, så regelen når ikke høy.",
    falsePositiveConsiderations: [
      "Analysebiblioteker leser sine egne informasjonskapsler og sender Image-signaler.",
    ],
  },
});

export const rule = makeJsRule(definition, {
  summary: (o) =>
    o.matched.includes("js.cookie_tilde_join")
      ? "An inspected script reads cookies and uses the '~~~' separator documented for cookie collection."
      : "An inspected script reads cookies and sends data via Image beacons.",
  significance:
    "The documented code split document.cookie on ';', joined it with '~~~', and sent it as a cookie= parameter. Cookie values were not observed by AdTripwire.",
  confidenceRationale: (o) =>
    `Matched: ${o.matched.join(", ")}. The pattern is consistent with cookie transmission but the destination and content were not observed.`,
  alternativeExplanations: [
    "First-party analytics reading its own cookies.",
    "Consent tools reading and reporting consent cookies.",
  ],
  nb: {
    summary: (o) =>
      o.matched.includes("js.cookie_tilde_join")
        ? "Et inspisert skript leser informasjonskapsler og bruker skilletegnet «~~~» som er dokumentert for innsamling av informasjonskapsler."
        : "Et inspisert skript leser informasjonskapsler og sender data via Image-signaler.",
    significance:
      "Den dokumenterte koden delte document.cookie på «;», slo sammen delene med «~~~» og sendte dem som parameteren cookie=. AdTripwire observerte ikke verdiene i informasjonskapslene.",
    confidenceRationale: (o) =>
      `Samsvar: ${o.matched.join(", ")}. Mønsteret er i tråd med overføring av informasjonskapsler, men mottaker og innhold ble ikke observert.`,
    alternativeExplanations: [
      "Førsteparts analyse som leser sine egne informasjonskapsler.",
      "Samtykkeverktøy som leser og rapporterer samtykkekapsler.",
    ],
  },
});
export const evaluate = rule.evaluate;
