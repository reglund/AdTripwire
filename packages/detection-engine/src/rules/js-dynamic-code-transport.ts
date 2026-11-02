import { BOTH } from "./references.js";
import { jsDefinition, makeJsRule } from "./js-common.js";

export const definition = jsDefinition({
  id: "js.dynamic_code_with_transport",
  version: "1.1.0",
  name: "Runtime code construction combined with a polling or socket channel and cryptography",
  description:
    "An inspected script combines runtime code construction (new Function or eval), a persistent or polling network channel (WebSocket, WebRTC, WebTransport, or a short setInterval), and Web Crypto usage — the combination documented for the AdFection operator-command loader.",
  severity: "suspicious",
  confidence: "medium",
  confidenceBasis:
    "Medium: each technique is ordinary on its own; the three-way combination matches the documented loader that fetched encrypted operator code and executed it with new Function.",
  requiredEvidence: [
    "Markers: (js.new_function or js.eval) AND (a transport/polling marker) AND (a crypto marker) in one response_inspected event, co-located: the analyser's js.colocated_dynamic_transport marker (first occurrences within 4000 characters).",
  ],
  references: BOTH,
  falsePositiveConsiderations: [
    "Real-time web apps and some bundlers combine sockets, crypto and eval-style module loading.",
    "Co-location uses first occurrences only, so a bundle whose first eval happens to sit near an unrelated socket helper can still match.",
  ],
});

export const rule = makeJsRule(definition, {
  summary: () =>
    "An inspected script combines runtime code construction, a polling or socket channel, and cryptography.",
  significance:
    "The documented operator loader polled for encrypted commands and executed them with new Function. This combination resembles it but does not establish the script's purpose.",
  confidenceRationale: (o) =>
    `Matched ${o.matched.length} markers across all three required groups; each is common alone, which is why confidence is not high.`,
  alternativeExplanations: [
    "A real-time web application or chat widget.",
    "A bundler runtime that evaluates modules and uses Web Crypto for integrity checks.",
  ],
});
export const evaluate = rule.evaluate;
