import type { NormalizedEvent } from "./events.js";

/**
 * Frame-lineage relation between two events.
 *
 * "related": same browser request; or same tab AND (same frame, or one event's frame is an
 *   ancestor of the other's, or both sit under a common ancestor frame other than the top
 *   document, i.e. inside the same ad iframe).
 * "unrelated": both events carry frame ancestry and none of the above holds.
 * "unknown": ancestry is missing (Chromium-like sensors), frame ids are unknown, or the events
 *   are linked only by an explicit correlation id across tabs.
 *
 * The top-level document (frame 0) is an ancestor of every frame in the tab, so it carries no
 * lineage information and is ignored in the ancestor tests. A top-document event is lineage-
 * related only to other top-document events and to sub_frame loads the top document itself
 * issued (a sub_frame request's parentFrameId is the document that inserted the frame).
 */
export type LineageRelation = "related" | "unrelated" | "unknown";

export function lineageRelation(a: NormalizedEvent, b: NormalizedEvent): LineageRelation {
  if (a.requestId !== undefined && a.requestId === b.requestId) return "related";
  if (a.tabId === undefined || b.tabId === undefined || a.tabId !== b.tabId) return "unknown";
  const fa = a.frameContext.frameId;
  const fb = b.frameContext.frameId;
  if (fa < 0 || fb < 0) return "unknown";
  if (fa === fb) return "related";
  if (isFrameLoadBy(a, fb) || isFrameLoadBy(b, fa)) return "related";
  const ancA = a.frameContext.ancestorFrameIds;
  const ancB = b.frameContext.ancestorFrameIds;
  if ((fa > 0 && ancB?.includes(fa)) || (fb > 0 && ancA?.includes(fb))) return "related";
  if (ancA === undefined || ancB === undefined) return "unknown";
  for (const x of ancA) if (x > 0 && ancB.includes(x)) return "related";
  return "unrelated";
}

/** True when `e` is a sub_frame request issued by the document in frame `frameId`. */
function isFrameLoadBy(e: NormalizedEvent, frameId: number): boolean {
  return e.resourceType === "sub_frame" && e.frameContext.parentFrameId === frameId;
}
