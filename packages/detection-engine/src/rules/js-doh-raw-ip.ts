import { BOTH } from "./references.js";
import { jsDefinition, makeJsRule } from "./js-common.js";

export const definition = jsDefinition({
  id: "js.doh_then_raw_ip",
  name: "Script resolves via DNS-over-HTTPS and fetches from a raw IP",
  description:
    "An inspected script queries Cloudflare DNS-over-HTTPS and fetches from a raw-IP or variable-host '/json' URL, the documented technique for reaching infrastructure without normal DNS.",
  severity: "suspicious",
  confidence: "medium",
  confidenceBasis:
    "Medium: the pairing matches the documented technique; DoH alone is used by some privacy and connectivity tools.",
  requiredEvidence: ["Markers js.doh_cloudflare AND js.raw_ip_fetch."],
  references: BOTH,
  falsePositiveConsiderations: [
    "Network diagnostics and CDN-selection scripts sometimes resolve names via DoH.",
  ],
  nb: {
    name: "Skript slår opp via DNS-over-HTTPS og henter fra en rå IP-adresse",
    description:
      "Et inspisert skript spør Cloudflare DNS-over-HTTPS og henter fra en URL med rå IP-adresse eller variabel vert og «/json», den dokumenterte teknikken for å nå infrastruktur uten vanlig DNS.",
    confidenceBasis:
      "Middels: kombinasjonen samsvarer med den dokumenterte teknikken; DoH alene brukes av enkelte personvern- og tilkoblingsverktøy.",
    falsePositiveConsiderations: [
      "Nettverksdiagnostikk og skript som velger CDN slår av og til opp navn via DoH.",
    ],
  },
});

export const rule = makeJsRule(definition, {
  summary: () =>
    "An inspected script resolves a hostname over DNS-over-HTTPS and then fetches from an IP address directly.",
  significance:
    "The documented code used Cloudflare DoH followed by a no-cors fetch to the resolved IP, bypassing hostname-based blocking.",
  confidenceRationale: () =>
    "Both halves of the documented technique are present; each has legitimate uses.",
  alternativeExplanations: ["A connectivity or latency test.", "CDN edge selection logic."],
  nb: {
    summary: () =>
      "Et inspisert skript slår opp et vertsnavn over DNS-over-HTTPS og henter deretter direkte fra en IP-adresse.",
    significance:
      "Den dokumenterte koden brukte Cloudflare DoH etterfulgt av en no-cors-henting fra den oppslåtte IP-adressen, og gikk dermed utenom blokkering basert på vertsnavn.",
    confidenceRationale: () =>
      "Begge halvdelene av den dokumenterte teknikken er til stede; hver av dem har legitim bruk.",
    alternativeExplanations: [
      "En test av tilkobling eller forsinkelse.",
      "Logikk for valg av CDN-node.",
    ],
  },
});
export const evaluate = rule.evaluate;
