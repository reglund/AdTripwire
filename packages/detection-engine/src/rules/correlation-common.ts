import type { EvidenceItem, NormalizedEvent, ObservationLimitation } from "@adtripwire/shared";
import type { RuleContext } from "./types.js";
import {
  SEVERITY_RANK,
  isFirstObservation,
  isJsContentType,
  relatedEvents,
  responseBytes,
} from "./common.js";
import { isNoasContact, isNoasPattern } from "./noas.js";
import { jsGrade } from "./js-common.js";

export const CORRELATION_LIMITATIONS = [
  "Temporal proximity does not prove causation; events are linked by frame lineage (or, when that is unavailable, by tab or correlation id) and time only.",
  "Browser request ids and frame ids do not survive restarts, and a single tab may host unrelated ad activity.",
];

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

/** True when any of the events lacks frame ancestry (lineage could not be evaluated). */
export function ancestryMissing(events: readonly NormalizedEvent[]): boolean {
  return events.some((x) => x.frameContext.ancestorFrameIds === undefined);
}

export type ChainScope = "lineage" | "tab";

/** A page-sensor signal usable as an observed step-2 equivalent (cross-origin insertion). */
export function isPageSignalStep2(e: NormalizedEvent): boolean {
  const p = e.eventType === "page_signal" ? e.pageSignal : undefined;
  if (!p || p.crossOrigin !== true) return false;
  return p.kind === "hidden_iframe_inserted" || p.kind === "script_inserted";
}

/**
 * Step 2: an inspected response that is either graded suspicious or higher by the JavaScript
 * technique rules, or non-empty JavaScript returned by a NOAS-pattern request or a host whose
 * indicator role is "noas". A response that was only sized (not inspected) never qualifies,
 * because its content type is unknown.
 */
export function isStep2(e: NormalizedEvent, ctx: RuleContext): boolean {
  if (e.eventType !== "request_completed" && e.eventType !== "response_inspected") return false;
  const insp = e.responseInspection;
  if (!insp) return false;
  const g = jsGrade(insp.markers);
  if (g !== null && SEVERITY_RANK[g] >= SEVERITY_RANK.suspicious) return true;
  const bytes = responseBytes(e);
  if (bytes === undefined || bytes <= 0) return false;
  if (!isJsContentType(insp.contentType) && insp.markers.length === 0) return false;
  return (
    isNoasPattern(e) ||
    ctx
      .indicatorMatches(e)
      .some((m) => m.indicator.classification === "surveillance" && m.indicator.role === "noas")
  );
}

/** Step 3: first sighting of a request to infrastructure classified malicious. */
export function isStep3(e: NormalizedEvent, ctx: RuleContext): boolean {
  if (
    e.eventType === "response_inspected" ||
    e.eventType === "request_redirected" ||
    e.eventType === "page_signal"
  )
    return false;
  if (!isFirstObservation(e, ctx)) return false;
  return ctx.indicatorMatches(e).some((m) => m.indicator.classification === "malicious");
}

export interface ChainSearch {
  s1?: NormalizedEvent;
  s2?: NormalizedEvent;
  /**
   * "lineage": every found step is frame-lineage related to the trigger (and s1 to s2).
   * "tab": found only by tab/correlation id; chain rules lower severity one level.
   */
  scope: ChainScope;
  /** True for a "tab" result where frame ancestry was missing on at least one step. */
  ancestryUnavailable: boolean;
  /**
   * The most recent lineage step 2 when the lineage holds no step 1 at all, even if a
   * tab-level chain was returned. Lets the script-only rule keep its lineage result instead of
   * being overridden by an ad-selection request in an unrelated frame.
   */
  lineageS2Only?: NormalizedEvent;
}

export interface ChainOptions {
  /** Accept a cross-origin page-sensor insertion in the lineage as step 2 (adfection chain only). */
  pageSignalStep2?: boolean;
}

/**
 * O(R): the most recent step 2 that has a step 1 strictly before it, else the most recent
 * step 2 alone (if any).
 */
function searchChain(
  related: readonly NormalizedEvent[],
  ctx: RuleContext,
  step2: (e: NormalizedEvent) => boolean,
): { s1?: NormalizedEvent; s2?: NormalizedEvent } {
  // Single forward pass: for each index, the most recent NOAS contact strictly before it.
  const lastS1Before: number[] = new Array<number>(related.length);
  let lastS1 = -1;
  for (let i = 0; i < related.length; i++) {
    lastS1Before[i] = lastS1;
    if (isNoasContact(related[i]!, ctx)) lastS1 = i;
  }
  let latestS2: NormalizedEvent | undefined;
  for (let i = related.length - 1; i >= 0; i--) {
    const s2 = related[i]!;
    if (!step2(s2)) continue;
    latestS2 ??= s2;
    const j = lastS1Before[i]!;
    if (j >= 0) return { s1: related[j]!, s2 };
  }
  return latestS2 ? { s2: latestS2 } : {};
}

/**
 * Search the trigger's frame lineage first, then the whole tab. Two O(R) passes.
 * A full chain found only at tab level is returned with scope "tab" (callers downgrade).
 */
export function findChain(
  e: NormalizedEvent,
  ctx: RuleContext,
  opts: ChainOptions = {},
): ChainSearch {
  const related = relatedEvents(e, ctx);
  const lineage = related.filter((x) => lineageRelation(x, e) === "related");
  const lin = searchChain(
    lineage,
    ctx,
    (x) => isStep2(x, ctx) || (opts.pageSignalStep2 === true && isPageSignalStep2(x)),
  );
  if (lin.s1 && lin.s2 && lineageRelation(lin.s1, lin.s2) === "related")
    return { s1: lin.s1, s2: lin.s2, scope: "lineage", ancestryUnavailable: false };
  const tab = searchChain(related, ctx, (x) => isStep2(x, ctx));
  if (tab.s1 && tab.s2)
    return {
      s1: tab.s1,
      s2: tab.s2,
      scope: "tab",
      ancestryUnavailable: ancestryMissing([e, tab.s1, tab.s2]),
      ...(lin.s2 && !lin.s1 ? { lineageS2Only: lin.s2 } : {}),
    };
  if (lin.s2)
    return {
      s2: lin.s2,
      scope: "lineage",
      ancestryUnavailable: false,
      ...(!lin.s1 ? { lineageS2Only: lin.s2 } : {}),
    };
  if (tab.s2)
    return { s2: tab.s2, scope: "tab", ancestryUnavailable: ancestryMissing([e, tab.s2]) };
  return { scope: "lineage", ancestryUnavailable: false };
}

/** Evidence item describing how the steps were linked (lineage observed, or tab-only inferred). */
export function scopeEvidence(
  scope: ChainScope,
  ancestryUnavailable: boolean,
  events: readonly NormalizedEvent[],
): EvidenceItem {
  const eventIds = events.map((x) => x.eventId);
  if (scope === "lineage")
    return {
      eventIds,
      observed:
        "The steps were observed in the same frame lineage (the same frame, or frames nested within one another).",
      kind: "observed",
    };
  return {
    eventIds,
    observed: ancestryUnavailable
      ? "Frame ancestry was not available for every step, so the steps could only be linked by sharing a tab and timing, not by frame lineage; the priority is lowered one level."
      : "The steps were in the same tab but not in the same frame lineage, so they may come from unrelated frames; the priority is lowered one level.",
    kind: "inferred",
  };
}

/** Limitations to add to missingVisibility for a tab-scope result without ancestry. */
export function scopeLimitations(
  scope: ChainScope,
  ancestryUnavailable: boolean,
): ObservationLimitation[] {
  return scope === "tab" && ancestryUnavailable ? ["frame_ancestry_unavailable"] : [];
}

/**
 * True when the step-1 host is the page's own top-level host. The documented NOAS servers are
 * third-party ad infrastructure; a first-party "/getAd" is more likely a spoof or an unrelated
 * endpoint, so chain rules downgrade severity in that case.
 */
export function isFirstPartyStep(s: NormalizedEvent): boolean {
  const top = s.frameContext.topHostname ?? s.frameContext.documentHostname;
  return top !== undefined && top === s.destination.hostname;
}

export function secondsBetween(a: NormalizedEvent, b: NormalizedEvent): number {
  return Math.round(Math.abs(b.timestamp - a.timestamp) / 1000);
}

export function step2Description(s2: NormalizedEvent): string {
  const p = s2.eventType === "page_signal" ? s2.pageSignal : undefined;
  if (p) {
    const what =
      p.kind === "hidden_iframe_inserted"
        ? "a hidden cross-origin iframe"
        : "a third-party script element";
    return `The page sensor observed ${what} being inserted after load${p.targetHostname ? ` (target ${p.targetHostname})` : ""} in the same frame lineage.`;
  }
  const insp = s2.responseInspection;
  if (insp)
    return `A response from ${s2.destination.hostname} was inspected (${insp.observedBytes} bytes, ${insp.markers.length} technique marker(s)).`;
  return `A non-empty response (${responseBytes(s2) ?? "unknown"} bytes) was returned by ${s2.destination.hostname}.`;
}

export function linkEvidence(
  a: NormalizedEvent,
  b: NormalizedEvent,
  what: string,
  scope: ChainScope = "tab",
): EvidenceItem {
  const sameRequest = a.requestId !== undefined && a.requestId === b.requestId;
  const basis = scope === "lineage" ? "shared frame lineage and timing" : "shared tab and timing";
  return sameRequest
    ? {
        eventIds: [a.eventId, b.eventId],
        observed: `${what}: both events belong to the same browser request.`,
        kind: "observed",
      }
    : {
        eventIds: [a.eventId, b.eventId],
        observed: `${what}: inferred only from ${basis} (${secondsBetween(a, b)} s apart); temporal proximity does not prove causation.`,
        kind: "inferred",
      };
}
