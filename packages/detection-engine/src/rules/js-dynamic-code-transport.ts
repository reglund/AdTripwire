import { BOTH } from "./references.js";
import { jsDefinition, makeJsRule } from "./js-common.js";

export const definition = jsDefinition({
  id: "js.dynamic_code_with_transport",
  name: "Runtime code construction combined with a polling or socket channel and cryptography",
  description:
    "An inspected script combines runtime code construction (new Function or eval), a persistent or polling network channel (WebSocket, WebRTC, WebTransport, or a short setInterval), and Web Crypto usage — the combination documented for the AdFection operator-command loader.",
  severity: "suspicious",
  confidence: "medium",
  confidenceBasis:
    "Medium: each technique is ordinary on its own; the three-way combination matches the documented loader that fetched encrypted operator code and executed it with new Function.",
  requiredEvidence: [
    "Markers: (js.new_function or js.eval) AND (a transport/polling marker) AND (a crypto marker) in one response_inspected event.",
  ],
  references: BOTH,
  falsePositiveConsiderations: [
    "Real-time web apps and some bundlers combine sockets, crypto and eval-style module loading.",
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
