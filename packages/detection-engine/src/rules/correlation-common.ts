import { lineageRelation } from "@adtripwire/shared";
import type {
  EvidenceItem,
  LineageRelation,
  NormalizedEvent,
  ObservationLimitation,
} from "@adtripwire/shared";
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

// Moved to @adtripwire/shared (lineage.ts) so packages/correlation can reuse it; re-exported here.
export { lineageRelation };
export type { LineageRelation };

/** True when any of the events lacks frame ancestry (lineage could not be evaluated). */
export function ancestryMissing(events: readonly NormalizedEvent[]): boolean {
  return events.some((x) => x.frameContext.ancestorFrameIds === undefined);
}

export type ChainScope = "lineage" | "tab";

/**
 * Strength of a page-sensor signal as an observed step-2 equivalent:
 * "strong": a cross-origin hidden iframe insertion, or a script insertion whose target host
 *   matches a current (not expired) surveillance or malicious indicator;
 * "weak": any other cross-origin script insertion (nearly every ad frame does this, so a chain
 *   whose only step 2 is weak is lowered one level);
 * null: not a usable step 2.
 */
export type PageStep2Strength = "strong" | "weak";

export function pageSignalStep2Strength(
  e: NormalizedEvent,
  ctx: RuleContext,
): PageStep2Strength | null {
  const p = e.eventType === "page_signal" ? e.pageSignal : undefined;
  if (!p || p.crossOrigin !== true) return null;
  if (p.kind === "hidden_iframe_inserted") return "strong";
  if (p.kind !== "script_inserted") return null;
  if (p.targetHostname !== undefined) {
    const hit = ctx.matcher
      .match(p.targetHostname, undefined, ctx.now)
      .some(
        (m) =>
          m.validity !== "expired" &&
          (m.indicator.classification === "surveillance" ||
            m.indicator.classification === "malicious"),
      );
    if (hit) return "strong";
  }
  return "weak";
}

/** True when `e` is a page signal usable as step 2 at any strength. */
export function isPageSignalStep2(e: NormalizedEvent, ctx: RuleContext): boolean {
  return pageSignalStep2Strength(e, ctx) !== null;
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

/**
 * A stored event that can serve as step 3 when the chain is completed retroactively by a late
 * page signal: a request-lifecycle event (not inspection, redirect, error or page signal) to
 * malicious-classified infrastructure.
 */
export function isStoredStep3(e: NormalizedEvent, ctx: RuleContext): boolean {
  if (
    e.eventType === "response_inspected" ||
    e.eventType === "request_redirected" ||
    e.eventType === "request_error" ||
    e.eventType === "page_signal" ||
    e.eventType === "frame_navigated"
  )
    return false;
  return ctx.indicatorMatches(e).some((m) => m.indicator.classification === "malicious");
}

/**
 * Retroactive chain for a late-arriving page-signal step 2 `sig`: the most recent lineage NOAS
 * contact at or before it, and the earliest lineage malicious contact at or after it, with
 * s1..s3 inside the correlation window and s1 lineage-related to s3. Page signals are ingested
 * after the requests they caused (the background awaits an ancestry lookup), but carry the
 * insertion time as timestamp. O(R) over the tab's events.
 */
export function findChainAroundSignal(
  sig: NormalizedEvent,
  ctx: RuleContext,
): { s1: NormalizedEvent; s3: NormalizedEvent } | null {
  if (sig.tabId === undefined || sig.tabId < 0) return null;
  const w = ctx.settings.correlationWindowMs;
  let s1: NormalizedEvent | undefined;
  let s3: NormalizedEvent | undefined;
  for (const x of ctx.window.byTab(sig.tabId)) {
    if (x.eventId === sig.eventId) continue;
    if (Math.abs(x.timestamp - sig.timestamp) > w) continue;
    if (lineageRelation(x, sig) !== "related") continue;
    if (x.timestamp <= sig.timestamp && isNoasContact(x, ctx)) {
      if (!s1 || x.timestamp >= s1.timestamp) s1 = x;
    } else if (x.timestamp >= sig.timestamp && isStoredStep3(x, ctx)) {
      if (!s3 || x.timestamp < s3.timestamp) s3 = x;
    }
  }
  if (!s1 || !s3) return null;
  if (s3.timestamp - s1.timestamp > w) return null;
  if (lineageRelation(s1, s3) !== "related") return null;
  return { s1, s3 };
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
  // Prefer a strong step 2 (inspected script, hidden frame, indicator-matching script insertion);
  // a plain script insertion only when no strong one completes a chain (it lowers severity).
  let lin = searchChain(
    lineage,
    ctx,
    (x) =>
      isStep2(x, ctx) ||
      (opts.pageSignalStep2 === true && pageSignalStep2Strength(x, ctx) === "strong"),
  );
  if (opts.pageSignalStep2 === true && !(lin.s1 && lin.s2)) {
    const weak = searchChain(lineage, ctx, (x) => isStep2(x, ctx) || isPageSignalStep2(x, ctx));
    if (weak.s1 && weak.s2) lin = weak;
  }
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
