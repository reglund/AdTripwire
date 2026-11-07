import { BOTH } from "./references.js";
import { jsDefinition, makeJsRule } from "./js-common.js";

export const definition = jsDefinition({
  id: "js.anti_analysis_trap",
  name: "Error.stack getter anti-debugging trap",
  description:
    "An inspected script defines a getter on an Error stack property, the documented anti-debugging trap. Alone it is informational; with obfuscation markers it is suspicious.",
  severity: "informational",
  confidence: "low",
  confidenceBasis:
    "Low: stack getters are also used by error-reporting and devtools-detection code; obfuscation co-occurrence raises severity, not confidence.",
  requiredEvidence: [
    "Marker js.error_stack_trap; obfuscation markers raise severity to suspicious.",
  ],
  references: BOTH,
  falsePositiveConsiderations: [
    "Error-monitoring libraries and anti-piracy scripts use similar traps.",
  ],
  nb: {
    name: "Feilsporing med Error.stack-getter som felle mot feilsøking",
    description:
      "Et inspisert skript definerer en getter på en stack-egenskap i Error, den dokumenterte fellen mot feilsøking. Alene er det informasjonsnivå; sammen med tilsløringsmarkører er det mistenkelig.",
    confidenceBasis:
      "Lav: stack-gettere brukes også av kode for feilrapportering og for å oppdage utviklerverktøy; at tilsløring forekommer sammen med den, hever alvorlighetsgraden, ikke tilliten.",
    falsePositiveConsiderations: [
      "Biblioteker for feilovervåking og skript mot piratkopiering bruker lignende feller.",
    ],
  },
});

export const rule = makeJsRule(definition, {
  summary: (o) =>
    o.severity === "suspicious"
      ? "An inspected, obfuscated script contains an anti-debugging trap."
      : "An inspected script contains a pattern used as an anti-debugging trap.",
  significance:
    "The documented code used an Error.stack getter to detect open developer tools. This is a weak signal on its own.",
  confidenceRationale: () =>
    "Stack-getter traps have ordinary uses; this is a single technique, not a combination.",
  alternativeExplanations: [
    "Error-reporting or devtools-detection code in ordinary sites.",
    "Anti-piracy protection on media players.",
  ],
  nb: {
    summary: (o) =>
      o.severity === "suspicious"
        ? "Et inspisert, tilslørt skript inneholder en felle mot feilsøking."
        : "Et inspisert skript inneholder et mønster som brukes som felle mot feilsøking.",
    significance:
      "Den dokumenterte koden brukte en Error.stack-getter for å oppdage åpne utviklerverktøy. Dette er et svakt signal alene.",
    confidenceRationale: () =>
      "Stack-getter-feller har vanlige bruksområder; dette er én enkelt teknikk, ikke en kombinasjon.",
    alternativeExplanations: [
      "Kode for feilrapportering eller oppdagelse av utviklerverktøy på vanlige nettsteder.",
      "Beskyttelse mot piratkopiering i mediespillere.",
    ],
  },
});
export const evaluate = rule.evaluate;
