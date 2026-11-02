import type { EvidenceItem, NormalizedEvent } from "@adtripwire/shared";
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
  "Temporal proximity within a tab does not prove causation; events are linked by tab or correlation id and time only.",
  "Browser request ids do not survive restarts, and a single tab may host unrelated ad activity.",
];

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
  if (e.eventType === "response_inspected" || e.eventType === "request_redirected") return false;
  if (!isFirstObservation(e, ctx)) return false;
  return ctx.indicatorMatches(e).some((m) => m.indicator.classification === "malicious");
}

export interface ChainSearch {
  s1?: NormalizedEvent;
  s2?: NormalizedEvent;
}

/**
 * Search backwards for the most recent step 2 that has a step 1 at or before it. If no step 2
 * has a preceding step 1, return only the most recent step 2 (if any).
 */
export function findChain(e: NormalizedEvent, ctx: RuleContext): ChainSearch {
  const related = relatedEvents(e, ctx);
  let latestS2: NormalizedEvent | undefined;
  for (let i = related.length - 1; i >= 0; i--) {
    const s2 = related[i]!;
    if (!isStep2(s2, ctx)) continue;
    latestS2 ??= s2;
    for (let j = i - 1; j >= 0; j--) {
      const s1 = related[j]!;
      if (isNoasContact(s1, ctx)) return { s1, s2 };
    }
  }
  return latestS2 ? { s2: latestS2 } : {};
}

export function secondsBetween(a: NormalizedEvent, b: NormalizedEvent): number {
  return Math.round(Math.abs(b.timestamp - a.timestamp) / 1000);
}

export function step2Description(s2: NormalizedEvent): string {
  const insp = s2.responseInspection;
  if (insp)
    return `A response from ${s2.destination.hostname} was inspected (${insp.observedBytes} bytes, ${insp.markers.length} technique marker(s)).`;
  return `A non-empty response (${responseBytes(s2) ?? "unknown"} bytes) was returned by ${s2.destination.hostname}.`;
}

export function linkEvidence(a: NormalizedEvent, b: NormalizedEvent, what: string): EvidenceItem {
  const sameRequest = a.requestId !== undefined && a.requestId === b.requestId;
  return sameRequest
    ? {
        eventIds: [a.eventId, b.eventId],
        observed: `${what}: both events belong to the same browser request.`,
        kind: "observed",
      }
    : {
        eventIds: [a.eventId, b.eventId],
        observed: `${what}: inferred only from shared tab and timing (${secondsBetween(a, b)} s apart); temporal proximity does not prove causation.`,
        kind: "inferred",
      };
}
