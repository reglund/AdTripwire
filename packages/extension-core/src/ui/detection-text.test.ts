import { describe, expect, it } from "vitest";
import type { Detection, DetectionTextNb, RuleDefinitionNb } from "@adtripwire/shared";
import {
  anyFallback,
  detectionRuleName,
  detectionSummary,
  detectionText,
  ruleNameMap,
  ruleText,
} from "./detection-text.js";

const NB: DetectionTextNb = {
  summary: "Kontakt med dokumentert infrastruktur",
  significance: "Betydning",
  confidenceRationale: "Begrunnelse",
  alternativeExplanations: ["Alternativ 1", "Alternativ 2"],
  recommendedActions: ["Tiltak 1"],
  limitations: ["Begrensning 1"],
  missingVisibility: ["Mangler 1", "Mangler 2"],
};

const EN = {
  summary: "Contact with documented infrastructure",
  significance: "Significance",
  confidenceRationale: "Rationale",
  alternativeExplanations: ["Alt 1", "Alt 2"],
  recommendedActions: ["Action 1"],
  limitations: ["Limit 1"],
  missingVisibility: ["Missing 1", "Missing 2"],
};

const withNb = { ...EN, nb: NB };

describe("detectionText", () => {
  it("returns English, with no fallback flag, in en mode regardless of nb", () => {
    for (const d of [EN, withNb]) {
      const r = detectionText(d, "en");
      expect(r.summary).toBe(EN.summary);
      expect(r.recommendedActions).toEqual(EN.recommendedActions);
      expect(r.fallback).toBe(false);
    }
  });

  it("uses every nb field whole in nb mode", () => {
    const r = detectionText(withNb, "nb");
    expect(r).toEqual({ ...NB, fallback: false });
  });

  it("falls back to English and flags it when nb is absent in nb mode", () => {
    const r = detectionText(EN, "nb");
    expect(r.summary).toBe(EN.summary);
    expect(r.alternativeExplanations).toEqual(EN.alternativeExplanations);
    expect(r.fallback).toBe(true);
  });

  it("treats a malformed nb as absent, never as a partial merge", () => {
    const broken = { ...EN, nb: { ...NB, recommendedActions: [] as string[], summary: "" } };
    const r = detectionText(broken, "nb");
    expect(r.summary).toBe(EN.summary);
    expect(r.fallback).toBe(true);
    const missingList = { ...EN, nb: { summary: "x" } as unknown as DetectionTextNb };
    expect(detectionText(missingList, "nb").recommendedActions).toEqual(EN.recommendedActions);
  });

  it("keeps array lengths of the chosen language (no per-index mixing)", () => {
    const shorter = { ...EN, nb: { ...NB, alternativeExplanations: ["Bare en"] } };
    expect(detectionText(shorter, "nb").alternativeExplanations).toEqual(["Bare en"]);
  });
});

describe("detectionSummary and anyFallback", () => {
  it("picks the summary per language", () => {
    expect(detectionSummary(withNb, "nb")).toBe(NB.summary);
    expect(detectionSummary(withNb, "en")).toBe(EN.summary);
    expect(detectionSummary(EN, "nb")).toBe(EN.summary);
  });

  it("reports a fallback only in nb mode and only when some detection lacks nb", () => {
    expect(anyFallback([withNb, withNb], "nb")).toBe(false);
    expect(anyFallback([withNb, EN], "nb")).toBe(true);
    expect(anyFallback([EN], "en")).toBe(false);
    expect(anyFallback([], "nb")).toBe(false);
  });
});

const RULE_NB: RuleDefinitionNb = {
  name: "Kontakt med overvåkingsinfrastruktur",
  description: "Beskrivelse",
  confidenceBasis: "Grunnlag",
  limitations: ["B1"],
  falsePositiveConsiderations: ["F1", "F2"],
};
const RULE = {
  id: "known_infra.surveillance_contact",
  name: "Surveillance contact",
  description: "Description",
  confidenceBasis: "Basis",
  limitations: ["L1"],
  falsePositiveConsiderations: ["P1", "P2"],
};

describe("ruleText", () => {
  it("uses nb in nb mode when the definition has it", () => {
    expect(ruleText({ ...RULE, nb: RULE_NB }, "nb")).toEqual(RULE_NB);
  });
  it("uses English in en mode, when nb is absent, or when nb is incomplete", () => {
    const en = {
      name: RULE.name,
      description: RULE.description,
      confidenceBasis: RULE.confidenceBasis,
      limitations: RULE.limitations,
      falsePositiveConsiderations: RULE.falsePositiveConsiderations,
    };
    expect(ruleText({ ...RULE, nb: RULE_NB }, "en")).toEqual(en);
    expect(ruleText(RULE, "nb")).toEqual(en);
    expect(ruleText({ ...RULE, nb: { ...RULE_NB, name: "" } }, "nb")).toEqual(en);
    expect(
      ruleText(
        { ...RULE, nb: { ...RULE_NB, limitations: undefined as unknown as string[] } },
        "nb",
      ),
    ).toEqual(en);
  });
});

describe("ruleNameMap and detectionRuleName", () => {
  const defs = [
    { definition: { id: RULE.id, name: RULE.name, nb: RULE_NB } },
    { definition: { id: "js.anti_analysis_trap", name: "Anti-analysis trap" } },
  ];
  const d = (ruleId: string): Pick<Detection, "ruleId" | "ruleName"> => ({
    ruleId,
    ruleName: "Stored English name",
  });

  it("maps to nb names in nb mode, English otherwise", () => {
    const nb = ruleNameMap(defs, "nb");
    expect(detectionRuleName(d(RULE.id), nb)).toBe(RULE_NB.name);
    expect(detectionRuleName(d("js.anti_analysis_trap"), nb)).toBe("Anti-analysis trap");
    const en = ruleNameMap(defs, "en");
    expect(detectionRuleName(d(RULE.id), en)).toBe(RULE.name);
  });

  it("falls back to the stored ruleName for an unknown rule id", () => {
    expect(detectionRuleName(d("retired.rule"), ruleNameMap(defs, "nb"))).toBe(
      "Stored English name",
    );
    expect(detectionRuleName(d("retired.rule"), new Map())).toBe("Stored English name");
  });
});
