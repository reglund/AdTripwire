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
});
export const evaluate = rule.evaluate;
