import { BOTH, CONFIANT } from "./references.js";
import { jsDefinition, makeJsRule } from "./js-common.js";

export const definition = jsDefinition({
  id: "js.adfection_sdk_markers",
  name: "Strings specific to the documented AdFection SDK",
  description:
    "An inspected script contains at least two strings specific to the SDK documented by Confiant (SDK_AUTH/remainingRequests, analytics_sdk_ready, script_tok=, getAdScript).",
  severity: "elevated",
  confidence: "high",
  confidenceBasis:
    "High: two or more distinctive strings from the documented SDK co-occurring is unlikely by chance. This is confidence in code resemblance, not in personal targeting.",
  requiredEvidence: [
    "Two or more of js.adfection_sdk_auth, js.adfection_sdk_ready, js.adfection_script_tok, js.adfection_getad_script_id.",
  ],
  references: [CONFIANT, ...BOTH.filter((r) => r.url !== CONFIANT.url)],
  falsePositiveConsiderations: [
    "Security research pages and indicator feeds may quote these strings.",
  ],
});

export const rule = makeJsRule(definition, {
  summary: (o) =>
    `An inspected script contains ${o.matched.length} strings specific to the SDK documented by Confiant.`,
  significance:
    "These strings appear in the delivery SDK documented in the AdFection investigation. Their presence suggests closely related code; it does not show what the code did on this device.",
  confidenceRationale: (o) =>
    `Matched ${o.matched.join(", ")}; these strings are distinctive to the documented SDK. Code resemblance is not proof of targeting.`,
  alternativeExplanations: [
    "A research write-up, test page or indicator feed quoting the strings.",
    "Unrelated code that happens to reuse the same names.",
  ],
});
export const evaluate = rule.evaluate;
