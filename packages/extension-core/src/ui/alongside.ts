/**
 * Pure helpers for the "Seen alongside" view: which empty state applies and how anchor ids are
 * shown. No DOM, so they can be tested directly. Wording lives in the view, never here.
 */
import type { AlongsideListing } from "@adtripwire/correlation";

/** The listing as the background returns it: the correlation listing plus anchor id → host. */
export interface AlongsideResponse extends AlongsideListing {
  anchorHosts: Record<string, string>;
}

export type AlongsideState =
  /** At least one hostname meets the minimum; the ranking is shown. */
  | "listed"
  /** No request to a documented host has been recorded. */
  | "no_anchors"
  /** Documented hosts were recorded, but only from the top document of pages. */
  | "page_scope_only"
  /** Documented hosts were recorded from ad frames, with no other hostname in their lineage. */
  | "no_candidates"
  /** Hostnames were seen alongside, but none reaches the minimum number of days. */
  | "below_minimum";

export function alongsideState(listing: AlongsideListing): AlongsideState {
  const t = listing.totals;
  if (listing.rows.length > 0) return "listed";
  if (t.anchorsSeen === 0) return "no_anchors";
  if (t.frameAnchors === 0) return "page_scope_only";
  if (t.frameHosts === 0) return "no_candidates";
  return "below_minimum";
}

/** Indicator ids resolved to their documented hostnames; an unknown id is shown as it is. */
export function anchorLabels(
  anchors: readonly string[],
  hosts: Readonly<Record<string, string>>,
): string[] {
  const out = anchors.map((id) => hosts[id] ?? id);
  return [...new Set(out)].sort();
}
