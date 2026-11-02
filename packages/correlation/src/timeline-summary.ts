/**
 * Deterministic timeline narrative for a set of detections and their supporting events.
 * Template text only; no inference beyond what the detections already state.
 */
import type { Detection, NormalizedEvent, TimelineStep, TimelineSummary } from "@adtripwire/shared";
import { SEVERITY_TEXT } from "./severity.js";
import { formatSpan } from "./cluster.js";

const MAX_STEPS = 40;

function offsetText(ms: number): string {
  if (ms < 1000) return "+0 s";
  const s = Math.round(ms / 1000);
  if (s < 120) return `+${s} s`;
  return `+${Math.round(s / 60)} min`;
}

export function describeEvent(ev: NormalizedEvent): string {
  const host = ev.destination.hostname;
  if (ev.pageSignal) {
    const target = ev.pageSignal.targetHostname ? ` targeting ${ev.pageSignal.targetHostname}` : "";
    return `page signal ${ev.pageSignal.kind.replace(/_/g, " ")}${target}`;
  }
  if (ev.eventType === "response_inspected") {
    const ri = ev.responseInspection;
    const m =
      ri && ri.markers.length > 0
        ? ` with ${ri.markers.length} technique marker(s)`
        : " with no technique markers";
    return `script body from ${host} inspected${m}`;
  }
  if (ev.eventType === "request_redirected") {
    return `request to ${host} redirected${ev.redirectHostname ? ` to ${ev.redirectHostname}` : ""}`;
  }
  const kind = ev.resourceType ? `${ev.resourceType.replace(/_/g, " ")} ` : "";
  const status = ev.statusCode !== undefined ? ` (status ${ev.statusCode})` : "";
  const depth = ev.frameContext.depth > 0 ? ` from a depth-${ev.frameContext.depth} frame` : "";
  const party = ev.frameContext.thirdParty ? ", third-party" : "";
  return `${kind}request to ${host}${ev.destination.pathPattern}${status}${depth}${party}`;
}

export function summarizeTimeline(
  detections: readonly Detection[],
  events: readonly NormalizedEvent[],
): TimelineSummary {
  const dets = [...detections].sort((a, b) => a.timestamp - b.timestamp);
  const cited = new Set(dets.flatMap((d) => d.eventIds));
  const evs = events.filter((e) => cited.has(e.eventId)).sort((a, b) => a.timestamp - b.timestamp);
  const start = Math.min(
    ...dets.map((d) => d.firstEventTimestamp),
    ...evs.map((e) => e.timestamp),
    Number.POSITIVE_INFINITY,
  );
  const base = Number.isFinite(start) ? start : 0;

  const steps: TimelineStep[] = [];
  const seenEvent = new Set<string>();
  for (const ev of evs) {
    if (seenEvent.has(ev.eventId)) continue;
    seenEvent.add(ev.eventId);
    steps.push({
      timestamp: ev.timestamp,
      offsetMs: Math.max(0, ev.timestamp - base),
      kind: "event",
      eventId: ev.eventId,
      text: describeEvent(ev),
    });
  }
  for (const d of dets) {
    steps.push({
      timestamp: d.timestamp,
      offsetMs: Math.max(0, d.timestamp - base),
      kind: "detection",
      detectionId: d.detectionId,
      severity: d.severity,
      text: `${d.ruleName} (${SEVERITY_TEXT[d.severity]}): ${d.summary}`,
    });
  }
  steps.sort((a, b) => a.timestamp - b.timestamp || (a.kind === "event" ? -1 : 1));
  const truncated = steps.length > MAX_STEPS;
  const kept = truncated ? steps.slice(0, MAX_STEPS) : steps;

  const tabs = new Set(dets.flatMap((d) => (d.tabId !== undefined ? [d.tabId] : [])));
  const last = kept.length > 0 ? kept[kept.length - 1]!.timestamp : base;
  const durationMs = Math.max(0, last - base);

  const sentences: string[] = [];
  if (kept.length === 0) sentences.push("No events or detections to summarise.");
  else {
    sentences.push(
      `Over ${formatSpan(durationMs)}${tabs.size === 1 ? " in one tab" : tabs.size > 1 ? ` across ${tabs.size} tabs` : ""}, AdTripwire recorded ${evs.length} supporting event(s) and ${dets.length} detection(s).`,
    );
    for (const s of kept) {
      sentences.push(`${offsetText(s.offsetMs)}: ${s.text}.`);
    }
    if (truncated) sentences.push(`${steps.length - MAX_STEPS} further step(s) omitted.`);
    sentences.push(
      "This sequence describes observed network and page activity; it does not establish what, if anything, happened on the device afterwards.",
    );
  }
  return { steps: kept, durationMs, tabCount: tabs.size, text: sentences.join(" "), truncated };
}
