import { BOTH } from "./references.js";
import { jsDefinition, makeJsRule } from "./js-common.js";

export const definition = jsDefinition({
  id: "js.cookie_exfil_pattern",
  name: "Script reads cookies and has an outbound beacon or the documented join separator",
  description:
    "An inspected script reads document.cookie and either joins values with the documented '~~~' separator or creates Image beacons, matching the documented first-party cookie collection.",
  severity: "elevated",
  confidence: "medium",
  confidenceBasis:
    "Medium: the '~~~' separator is specific to the documented code; Image beacons with cookie reads are also used by ordinary analytics, so the rule does not reach high.",
  requiredEvidence: ["Markers js.cookie_read AND (js.cookie_tilde_join OR js.image_beacon)."],
  references: BOTH,
  falsePositiveConsiderations: [
    "Analytics libraries read their own cookies and send Image beacons.",
  ],
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
});
export const evaluate = rule.evaluate;
