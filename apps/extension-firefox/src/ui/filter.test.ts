import { describe, expect, it } from "vitest";
import { atLeast, defaultFilterState, toDetectionFilter } from "./filter.js";
import { SEVERITY_ORDER } from "./format.js";

describe("toDetectionFilter", () => {
  const now = 1_700_000_000_000;

  it("omits every unset control", () => {
    expect(toDetectionFilter(defaultFilterState(), now, 100)).toEqual({ limit: 100 });
  });

  it("maps categories, minimum severity/confidence and since", () => {
    const f = toDetectionFilter(
      {
        categories: ["profiling", "known_infrastructure"],
        minSeverity: "elevated",
        minConfidence: "medium",
        since: "24h",
      },
      now,
    );
    expect(f.categories).toEqual(["profiling", "known_infrastructure"]);
    expect(f.severities).toEqual(["elevated", "high_priority"]);
    expect(f.confidences).toEqual(["medium", "high"]);
    expect(f.since).toBe(now - 24 * 3_600_000);
  });

  it("does not alias the state's category array", () => {
    const state = { ...defaultFilterState(), categories: ["profiling"] };
    const f = toDetectionFilter(state, now);
    f.categories?.push("x");
    expect(state.categories).toEqual(["profiling"]);
  });
});

describe("atLeast", () => {
  it("returns the level and everything above it", () => {
    expect(atLeast(SEVERITY_ORDER, "informational")).toEqual([...SEVERITY_ORDER]);
    expect(atLeast(SEVERITY_ORDER, "high_priority")).toEqual(["high_priority"]);
  });
});
