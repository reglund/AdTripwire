import type {
  Confidence,
  Detection,
  NormalizedEvent,
  RuleDefinition,
  Severity,
} from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { JS_COLOCATION_MAX_CHARS, JS_MARKER_DESCRIPTIONS } from "../js-analyzer.js";

/**
 * Co-location threshold for the dynamic-code and cookie-exfiltration combinations: the analyser
 * emits "js.colocated_dynamic_transport" / "js.colocated_cookie_exfil" only when one marker of
 * each required group has its first occurrence within this many characters of the others.
 * Markers scattered across an unrelated bundle therefore no longer combine.
 */
export const COLOCATION_MAX_CHARS = JS_COLOCATION_MAX_CHARS;
import { SEVERITY_RANK, buildDetection } from "./common.js";

export interface JsOutcome {
  severity: Severity;
  confidence: Confidence;
  matched: string[];
}
export type JsCombo = (m: ReadonlySet<string>) => JsOutcome | null;

const any = (m: ReadonlySet<string>, ids: string[]): string[] => ids.filter((i) => m.has(i));

export const CRYPTO_MARKERS = ["js.crypto_subtle", "js.ecdh", "js.aes_cbc", "js.rsa_oaep"];
export const OBFUSCATION_MARKERS = [
  "js.obfuscation_hex_escapes",
  "js.obfuscation_bang_bracket",
  "js.obfuscation_short_identifiers",
];
export const SDK_MARKERS = [
  "js.adfection_sdk_auth",
  "js.adfection_sdk_ready",
  "js.adfection_script_tok",
  "js.adfection_getad_script_id",
];

export const COMBOS: Record<string, JsCombo> = {
  "js.dynamic_code_with_transport": (m) => {
    const dyn = any(m, ["js.new_function", "js.eval"]);
    const transport = any(m, ["js.websocket", "js.webrtc", "js.webtransport", "js.timer_polling"]);
    const crypto = any(m, CRYPTO_MARKERS);
    if (!dyn.length || !transport.length || !crypto.length) return null;
    if (!m.has("js.colocated_dynamic_transport")) return null;
    return {
      severity: "suspicious",
      confidence: "medium",
      matched: [...dyn, ...transport, ...crypto, "js.colocated_dynamic_transport"],
    };
  },
  "js.hidden_iframe_injection": (m) => {
    if (!m.has("js.iframe_create") || !m.has("js.iframe_1x1")) return null;
    const inject = m.has("js.script_inject");
    return {
      severity: "suspicious",
      confidence: inject ? "medium" : "low",
      matched: ["js.iframe_create", "js.iframe_1x1", ...(inject ? ["js.script_inject"] : [])],
    };
  },
  "js.cookie_exfil_pattern": (m) => {
    const out = any(m, ["js.cookie_tilde_join", "js.image_beacon"]);
    if (!m.has("js.cookie_read") || !out.length) return null;
    if (!m.has("js.colocated_cookie_exfil")) return null;
    return {
      severity: "elevated",
      confidence: "medium",
      matched: ["js.cookie_read", ...out, "js.colocated_cookie_exfil"],
    };
  },
  "js.adfection_sdk_markers": (m) => {
    const hit = any(m, SDK_MARKERS);
    if (hit.length < 2) return null;
    return { severity: "elevated", confidence: "high", matched: hit };
  },
  "js.doh_then_raw_ip": (m) => {
    if (!m.has("js.doh_cloudflare") || !m.has("js.raw_ip_fetch")) return null;
    return {
      severity: "suspicious",
      confidence: "medium",
      matched: ["js.doh_cloudflare", "js.raw_ip_fetch"],
    };
  },
  "js.anti_analysis_trap": (m) => {
    if (!m.has("js.error_stack_trap")) return null;
    const obf = any(m, OBFUSCATION_MARKERS);
    return obf.length
      ? { severity: "suspicious", confidence: "low", matched: ["js.error_stack_trap", ...obf] }
      : { severity: "informational", confidence: "low", matched: ["js.error_stack_trap"] };
  },
};

/** Highest severity any JavaScript-technique rule would assign to this marker set, or null. */
export function jsGrade(markers: readonly string[]): Severity | null {
  const set = new Set(markers);
  let best: Severity | null = null;
  for (const combo of Object.values(COMBOS)) {
    const o = combo(set);
    if (o && (best === null || SEVERITY_RANK[o.severity] > SEVERITY_RANK[best])) best = o.severity;
  }
  return best;
}

export const JS_LIMITATIONS = [
  "Only a bounded prefix of selected responses is analysed, using lexical patterns; code that is fetched later, or heavily obfuscated, may not be recognised.",
  "Markers show that code contains a technique, not that it ran or what it did.",
];

export interface JsRuleTexts {
  summary: (o: JsOutcome) => string;
  significance: string;
  confidenceRationale: (o: JsOutcome) => string;
  alternativeExplanations: string[];
}

export function makeJsRule(definition: RuleDefinition, texts: JsRuleTexts): Rule {
  const combo = COMBOS[definition.id];
  if (!combo) throw new Error(`No marker combination for ${definition.id}`);
  const evaluate = (event: NormalizedEvent, ctx: RuleContext): Detection[] => {
    if (event.eventType !== "response_inspected" || !event.responseInspection) return [];
    const o = combo(new Set(event.responseInspection.markers));
    if (!o) return [];
    const host = event.destination.hostname;
    return [
      buildDetection(definition, ctx, {
        subject: `${host}|${event.destination.pathPattern}`,
        severity: o.severity,
        confidence: o.confidence,
        confidenceRationale: texts.confidenceRationale(o),
        summary: texts.summary(o),
        significance: texts.significance,
        evidence: [
          ...o.matched.map((id) => ({
            eventIds: [event.eventId],
            observed: `${id}: ${JS_MARKER_DESCRIPTIONS[id] ?? "technique marker"}`,
            kind: "observed" as const,
          })),
          ...(event.responseInspection.truncated
            ? [
                {
                  eventIds: [event.eventId],
                  observed: "Only a prefix of the response was analysed.",
                  kind: "observed" as const,
                },
              ]
            : []),
        ],
        events: [event],
        matchedIndicatorIds: ctx.indicatorMatches(event).map((m) => m.indicator.id),
        subjectHostnames: [host],
        alternativeExplanations: texts.alternativeExplanations,
        recommendedActions: [
          "Review where this script was loaded from and whether it followed an ad request in the same tab.",
          "Check for follow-on contact with documented infrastructure.",
        ],
      }),
    ];
  };
  return { definition, evaluate };
}

export function jsDefinition(
  d: Omit<RuleDefinition, "category" | "requiredCapabilities" | "version" | "limitations"> & {
    limitations?: string[];
    version?: string;
  },
): RuleDefinition {
  return {
    ...d,
    version: d.version ?? "1.0.0",
    category: "javascript_technique",
    requiredCapabilities: ["request_metadata", "response_body_inspection"],
    limitations: [...JS_LIMITATIONS, ...(d.limitations ?? [])],
  };
}
