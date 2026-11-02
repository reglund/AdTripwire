import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@adtripwire/shared";
import { groupByTab, parseTabId, sinceTimestamp, sortTimeline, tabLabel } from "./timeline.js";

const entry = (timestamp: number, tabId?: number, summary = "s"): TimelineEntry => ({
  timestamp,
  kind: "event",
  summary,
  ...(tabId !== undefined ? { tabId } : {}),
});

describe("sinceTimestamp", () => {
  const now = 1_000_000_000_000;
  it("maps each choice to a lower bound", () => {
    expect(sinceTimestamp("1h", now)).toBe(now - 3_600_000);
    expect(sinceTimestamp("24h", now)).toBe(now - 86_400_000);
    expect(sinceTimestamp("7d", now)).toBe(now - 7 * 86_400_000);
  });
  it("returns undefined for all and unknown values", () => {
    expect(sinceTimestamp("all", now)).toBeUndefined();
    expect(sinceTimestamp("bogus", now)).toBeUndefined();
  });
});

describe("parseTabId", () => {
  it("treats empty input as all tabs", () => {
    expect(parseTabId("")).toEqual({ ok: true, tabId: undefined });
    expect(parseTabId("  ")).toEqual({ ok: true, tabId: undefined });
  });
  it("accepts whole numbers", () => {
    expect(parseTabId(" 42 ")).toEqual({ ok: true, tabId: 42 });
    expect(parseTabId("0")).toEqual({ ok: true, tabId: 0 });
  });
  it("rejects everything else", () => {
    for (const bad of ["-1", "1.5", "abc", "1e3", "12345678901"]) {
      expect(parseTabId(bad).ok).toBe(false);
    }
  });
});

describe("sortTimeline and groupByTab", () => {
  it("sorts oldest first and keeps ties stable", () => {
    const sorted = sortTimeline([entry(3, 1, "c"), entry(1, 1, "a1"), entry(1, 2, "a2")]);
    expect(sorted.map((e) => e.summary)).toEqual(["a1", "a2", "c"]);
  });
  it("groups only consecutive entries with the same tab id", () => {
    const groups = groupByTab([entry(1, 1), entry(2, 1), entry(3, 2), entry(4, 1), entry(5)]);
    expect(groups.map((g) => [g.tabId, g.entries.length])).toEqual([
      [1, 2],
      [2, 1],
      [1, 1],
      [undefined, 1],
    ]);
  });
  it("returns no groups for no entries", () => {
    expect(groupByTab([])).toEqual([]);
  });
  it("labels tabs", () => {
    expect(tabLabel(7)).toBe("Tab 7");
    expect(tabLabel(undefined)).toBe("No tab");
  });
});
