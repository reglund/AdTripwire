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
  nb: {
    name: "Kodebygging under kjøring kombinert med en polling- eller socket-kanal og kryptografi",
    description:
      "Et inspisert skript kombinerer kodebygging under kjøring (new Function eller eval), en vedvarende eller polling-basert nettverkskanal (WebSocket, WebRTC, WebTransport eller en kort setInterval) og bruk av Web Crypto, kombinasjonen som er dokumentert for AdFection-operatørens kommandoinnlaster.",
    confidenceBasis:
      "Middels: hver teknikk er vanlig alene; kombinasjonen av alle tre samsvarer med den dokumenterte komponenten som lastet inn kryptert operatørkode og kjørte den med new Function.",
    falsePositiveConsiderations: [
      "Sanntids-nettapper og enkelte bundlere kombinerer sockets, kryptografi og modullasting i eval-stil.",
      "Samlokaliseringen bruker bare første forekomster, så en bundle der første eval tilfeldigvis ligger nær en urelatert socket-hjelper kan fortsatt gi treff.",
    ],
  },
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
  nb: {
    summary: () =>
      "Et inspisert skript kombinerer kodebygging under kjøring, en polling- eller socket-kanal og kryptografi.",
    significance:
      "Den dokumenterte komponenten som lastet inn operatørkommandoer spurte jevnlig etter krypterte kommandoer og kjørte dem med new Function. Denne kombinasjonen ligner på den, men fastslår ikke hva skriptet var ment til.",
    confidenceRationale: (o) =>
      `Samsvar med ${o.matched.length} markører på tvers av alle tre påkrevde grupper; hver er vanlig alene, og derfor er tilliten ikke høy.`,
    alternativeExplanations: [
      "En sanntids-nettapp eller en chat-widget.",
      "En bundler-kjøretid som evaluerer moduler og bruker Web Crypto til integritetssjekker.",
    ],
  },
});
export const evaluate = rule.evaluate;
