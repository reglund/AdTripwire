/**
 * Language selection for detection and rule-definition text. Pure: the caller passes the
 * language, so nothing here reads global state.
 *
 * Detections and rule definitions carry English text and, when the rule had Norwegian text at
 * detection time, an `nb` twin. In nb mode the twin is used whole (arrays are never merged per
 * index); detections stored before the twin existed fall back to English and are flagged so the
 * view can say so once. Evidence lines (`evidence[].observed`) have no twin and stay English.
 */
import {
  sanitizeDetectionNb,
  type Detection,
  type DetectionTextNb,
  type RuleDefinition,
  type RuleDefinitionNb,
} from "@adtripwire/shared";
import type { UiLanguage } from "./i18n.js";

type DetectionTextFields = Pick<
  Detection,
  | "summary"
  | "significance"
  | "confidenceRationale"
  | "alternativeExplanations"
  | "recommendedActions"
  | "limitations"
  | "missingVisibility"
>;

export interface DetectionTextChoice extends DetectionTextFields {
  /** True when nb was requested but this detection has no usable nb text (shown in English). */
  fallback: boolean;
}

/** The detection's text in the requested language, with English as the fallback. */
export function detectionText(
  d: DetectionTextFields & { nb?: DetectionTextNb | undefined },
  lang: UiLanguage,
): DetectionTextChoice {
  const nb = lang === "nb" ? sanitizeDetectionNb(d.nb) : undefined;
  if (nb) return { ...nb, fallback: false };
  return {
    summary: d.summary,
    significance: d.significance,
    confidenceRationale: d.confidenceRationale,
    alternativeExplanations: d.alternativeExplanations,
    recommendedActions: d.recommendedActions,
    limitations: d.limitations,
    missingVisibility: d.missingVisibility,
    fallback: lang === "nb",
  };
}

/** Summary line only (lists and tables). */
export function detectionSummary(
  d: Pick<Detection, "summary"> & { nb?: DetectionTextNb | undefined },
  lang: UiLanguage,
): string {
  return (lang === "nb" ? sanitizeDetectionNb(d.nb)?.summary : undefined) ?? d.summary;
}

/** True when nb was requested and at least one of the detections would be shown in English. */
export function anyFallback(
  list: ReadonlyArray<Pick<Detection, "summary"> & { nb?: DetectionTextNb | undefined }>,
  lang: UiLanguage,
): boolean {
  return lang === "nb" && list.some((d) => sanitizeDetectionNb(d.nb) === undefined);
}

export interface RuleTextChoice {
  name: string;
  description: string;
  confidenceBasis: string;
  limitations: string[];
  falsePositiveConsiderations: string[];
}

function validRuleNb(nb: unknown): nb is RuleDefinitionNb {
  if (!nb || typeof nb !== "object") return false;
  const o = nb as Record<string, unknown>;
  const str = (v: unknown): boolean => typeof v === "string" && v.length > 0;
  const list = (v: unknown): boolean => Array.isArray(v) && v.every(str);
  return (
    str(o["name"]) &&
    str(o["description"]) &&
    str(o["confidenceBasis"]) &&
    list(o["limitations"]) &&
    list(o["falsePositiveConsiderations"])
  );
}

/** A rule definition's text in the requested language; English when it has no nb twin. */
export function ruleText(
  def: Pick<
    RuleDefinition,
    "name" | "description" | "confidenceBasis" | "limitations" | "falsePositiveConsiderations"
  > & { nb?: RuleDefinitionNb | undefined },
  lang: UiLanguage,
): RuleTextChoice {
  if (lang === "nb" && validRuleNb(def.nb)) {
    const { name, description, confidenceBasis, limitations, falsePositiveConsiderations } = def.nb;
    return { name, description, confidenceBasis, limitations, falsePositiveConsiderations };
  }
  return {
    name: def.name,
    description: def.description,
    confidenceBasis: def.confidenceBasis,
    limitations: def.limitations,
    falsePositiveConsiderations: def.falsePositiveConsiderations,
  };
}

/** ruleId -> display name in the requested language (only for rules that have a definition). */
export function ruleNameMap(
  defs: ReadonlyArray<{
    definition: Pick<RuleDefinition, "id" | "name"> & { nb?: RuleDefinitionNb | undefined };
  }>,
  lang: UiLanguage,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const { definition } of defs) {
    const nbName = lang === "nb" ? definition.nb?.name : undefined;
    out.set(definition.id, typeof nbName === "string" && nbName ? nbName : definition.name);
  }
  return out;
}

/** Rule name for a detection: the nb definition name when known, else the stored English name. */
export function detectionRuleName(
  d: Pick<Detection, "ruleId" | "ruleName">,
  names: ReadonlyMap<string, string>,
): string {
  return names.get(d.ruleId) ?? d.ruleName;
}
