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
});
export const evaluate = rule.evaluate;
