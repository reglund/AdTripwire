import { describe, expect, it } from "vitest";
import type { AlongsideListing, AlongsideRow } from "@adtripwire/correlation";
import { alongsideState, anchorLabels } from "./alongside.js";

const row = (hostname: string): AlongsideRow => ({
  hostname,
  alongsideDays: 2,
  seenDays: 3,
  share: 2 / 3,
  anchors: ["a-1"],
  frameDays: 2,
  pageDays: 0,
  lastSeen: "2026-11-05",
});

function listing(
  totals: Partial<AlongsideListing["totals"]> = {},
  rows: AlongsideRow[] = [],
): AlongsideListing {
  return {
    rows,
    pageOnly: [],
    totals: {
      anchorsSeen: 0,
      frameAnchors: 0,
      pageAnchors: 0,
      anchorDays: 0,
      hostsTracked: 0,
      frameHosts: 0,
      minAlongsideDays: 2,
      ...totals,
    },
  };
}

describe("alongsideState", () => {
  it("is no_anchors when no documented host was recorded", () => {
    expect(alongsideState(listing())).toBe("no_anchors");
  });
  it("is page_scope_only when every anchor sat in the top document", () => {
    expect(alongsideState(listing({ anchorsSeen: 3, pageAnchors: 3, hostsTracked: 4 }))).toBe(
      "page_scope_only",
    );
  });
  it("is no_candidates when ad-frame anchors had no other hostname", () => {
    expect(alongsideState(listing({ anchorsSeen: 1, frameAnchors: 1 }))).toBe("no_candidates");
  });
  it("is below_minimum when candidates exist but none reaches the minimum days", () => {
    expect(
      alongsideState(listing({ anchorsSeen: 2, frameAnchors: 2, frameHosts: 5, hostsTracked: 5 })),
    ).toBe("below_minimum");
  });
  it("is listed as soon as a row exists, whatever the totals say", () => {
    expect(
      alongsideState(listing({ anchorsSeen: 2, frameAnchors: 2, frameHosts: 1 }, [row("x.test")])),
    ).toBe("listed");
  });
  it("checks page-scope-only before candidate counts when frame anchors are zero", () => {
    expect(alongsideState(listing({ anchorsSeen: 1, pageAnchors: 1, frameHosts: 0 }))).toBe(
      "page_scope_only",
    );
  });
});

describe("anchorLabels", () => {
  it("resolves ids to hostnames, de-duplicates, sorts and falls back to the id", () => {
    expect(anchorLabels(["b", "a", "c", "z"], { a: "h1.test", b: "h1.test", c: "g.test" })).toEqual(
      ["g.test", "h1.test", "z"],
    );
  });
  it("returns an empty list for no anchors", () => {
    expect(anchorLabels([], {})).toEqual([]);
  });
});
