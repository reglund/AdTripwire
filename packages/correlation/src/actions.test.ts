import { describe, expect, it } from "vitest";
import { clusterDetections } from "./cluster.js";
import { ACTIONS_DISCLAIMER, suggestActions } from "./actions.js";
import { CHROMIUM_CAPS, det, FIREFOX_CAPS } from "./test-fixtures.js";

const opts = { windowMs: 60_000 };

describe("suggestActions", () => {
  it("suggests preserving evidence and specialist review for an elevated malicious-contact cluster", () => {
    const d = det({
      detectionId: "a",
      ruleId: "known_infra.malicious_contact",
      severity: "elevated",
    });
    const k = clusterDetections([d], opts)[0]!;
    const s = suggestActions(k, [d], FIREFOX_CAPS);
    expect(s.actions.map((a) => a.id)).toEqual([
      "preserve_evidence",
      "specialist_review",
      "enable_page_sensor",
    ]);
    expect(s.actions[0]!.priority).toBe("now");
    expect(s.fromRules).toEqual(["Preserve the evidence export."]);
    expect(s.disclaimer).toBe(ACTIONS_DISCLAIMER);
  });

  it("recommends Firefox reproduction when response bodies are not visible", () => {
    const d = det({
      detectionId: "a",
      severity: "suspicious",
      ruleId: "ad_delivery.noas_request",
      category: "ad_delivery_behaviour",
    });
    const k = clusterDetections([d], opts)[0]!;
    const ids = suggestActions(k, [d], CHROMIUM_CAPS).actions.map((a) => a.id);
    expect(ids).toContain("reproduce_firefox");
    expect(ids).not.toContain("preserve_evidence");
  });

  it("falls back to keep-monitoring for informational unrelated members", () => {
    const d = det({
      detectionId: "a",
      severity: "informational",
      ruleId: "profiling.identifier_rich_request",
      category: "profiling",
    });
    const k = clusterDetections([d], opts)[0]!;
    const caps = {
      ...FIREFOX_CAPS,
      capabilities: [...FIREFOX_CAPS.capabilities, "page_signals" as const],
    };
    expect(suggestActions(k, [d], caps).actions.map((a) => a.id)).toEqual(["keep_monitoring"]);
  });

  it("suggests comparing tabs for multi-tab clusters", () => {
    const a = det({
      detectionId: "a",
      tabId: 1,
      subjectHostnames: ["s.test"],
      severity: "suspicious",
    });
    const b = det({
      detectionId: "b",
      tabId: 2,
      subjectHostnames: ["s.test"],
      severity: "suspicious",
    });
    const k = clusterDetections([a, b], opts)[0]!;
    expect(suggestActions(k, [a, b], FIREFOX_CAPS).actions.map((x) => x.id)).toContain(
      "compare_tabs",
    );
  });

  it("never uses verdict wording", () => {
    const d = det({
      detectionId: "a",
      ruleId: "correlation.adfection_chain",
      severity: "high_priority",
    });
    const k = clusterDetections([d], opts)[0]!;
    const all = suggestActions(k, [d], CHROMIUM_CAPS);
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/\binfected\b|\bspied\b|\bis safe\b|\bcompromised\b/i);
  });
});
