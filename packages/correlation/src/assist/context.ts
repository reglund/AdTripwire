/**
 * Builds the ONLY data structure a local model may receive. Every field is allowlisted and
 * re-sanitized here, independent of upstream sanitisation: hostnames must match the
 * hostname grammar, path patterns are reduced to a conservative character set and length,
 * free text comes from rule definitions and is length-capped. Analyst notes are never part
 * of the context.
 */
import type {
  AssistContext,
  AssistDetectionView,
  AssistEventView,
  AssistLanguage,
  Detection,
  DetectionCluster,
  NormalizedEvent,
  SensorCapabilities,
  SuggestedActions,
  TimelineSummary,
} from "@adtripwire/shared";

export interface AssistContextInput {
  language: AssistLanguage;
  productVersion: string;
  capabilities: SensorCapabilities;
  detections: readonly Detection[];
  events: readonly NormalizedEvent[];
  timeline: TimelineSummary;
  actions: SuggestedActions;
  cluster?: DetectionCluster;
  now?: number;
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what we strip
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,62})?(\.[a-z0-9]([a-z0-9-]{0,62})?)*$/;
const MAX_TEXT = 400;
const MAX_LIST = 12;
const MAX_EVENTS = 40;
const MAX_DETECTIONS = 20;
const MAX_PATH = 80;

export function sanitizeHostname(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/\.$/, "");
  return HOSTNAME_RE.test(h) ? h : null;
}

function text(s: string, max = MAX_TEXT): string {
  const t = s
    .replace(CONTROL_RE, " ")
    .replace(/={3,}/g, "=") // never let rule text close the EVIDENCE fence
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function textList(list: readonly string[], max = MAX_LIST): string[] {
  return list.slice(0, max).map((s) => text(s));
}

function pathPattern(p: string): string {
  const cleaned = p.replace(/[^A-Za-z0-9/._{}~-]/g, "");
  const out = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  return out.length > MAX_PATH ? `${out.slice(0, MAX_PATH)}…` : out;
}

function hostnamesOf(
  detections: readonly Detection[],
  events: readonly NormalizedEvent[],
): string[] {
  const set = new Set<string>();
  for (const d of detections)
    for (const h of d.subjectHostnames) {
      const s = sanitizeHostname(h);
      if (s) set.add(s);
    }
  for (const e of events) {
    for (const h of [
      e.destination.hostname,
      e.redirectHostname,
      e.frameContext.documentHostname,
      e.frameContext.topHostname,
      e.pageSignal?.targetHostname,
      ...e.frameContext.ancestorHostnames,
    ]) {
      if (!h) continue;
      const s = sanitizeHostname(h);
      if (s) set.add(s);
    }
  }
  return [...set].sort();
}

function referenceHostnames(detections: readonly Detection[]): string[] {
  const set = new Set<string>();
  for (const d of detections)
    for (const r of d.references) {
      try {
        const s = sanitizeHostname(new URL(r.url).hostname);
        if (s) set.add(s);
      } catch {
        // ignore malformed reference urls
      }
    }
  return [...set].sort();
}

export function buildAssistContext(input: AssistContextInput): AssistContext {
  const dets = [...input.detections]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, MAX_DETECTIONS);
  const cited = new Set(dets.flatMap((d) => d.eventIds));
  const evs = input.events
    .filter((e) => cited.has(e.eventId))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, MAX_EVENTS);
  const base = Math.min(
    ...dets.map((d) => d.firstEventTimestamp),
    ...evs.map((e) => e.timestamp),
    Number.POSITIVE_INFINITY,
  );
  const t0 = Number.isFinite(base) ? base : 0;
  const offset = (ts: number): number => Math.max(0, Math.round((ts - t0) / 1000));

  const detections: AssistDetectionView[] = dets.map((d) => ({
    ruleId: text(d.ruleId, 80),
    ruleName: text(d.ruleName, 120),
    category: d.category,
    severity: d.severity,
    confidence: d.confidence,
    confidenceRationale: text(d.confidenceRationale),
    summary: text(d.summary),
    significance: text(d.significance),
    observed: textList(d.evidence.map((e) => e.observed)),
    alternativeExplanations: textList(d.alternativeExplanations),
    missingVisibility: textList(d.missingVisibility),
    subjectHostnames: d.subjectHostnames
      .map(sanitizeHostname)
      .filter((h): h is string => h !== null),
    matchedIndicatorIds: d.matchedIndicatorIds.slice(0, MAX_LIST).map((s) => text(s, 128)),
    offsetSeconds: offset(d.timestamp),
  }));

  const events: AssistEventView[] = evs.map((e) => {
    const v: AssistEventView = {
      offsetSeconds: offset(e.timestamp),
      eventType: text(e.pageSignal ? `page_signal:${e.pageSignal.kind}` : e.eventType, 64),
      hostname: sanitizeHostname(e.destination.hostname) ?? "[invalid hostname]",
      pathPattern: pathPattern(e.destination.pathPattern),
      frameDepth: e.frameContext.depth,
      markers: (e.responseInspection?.markers ?? []).slice(0, MAX_LIST).map((m) => text(m, 64)),
      limitations: e.observationLimitations.slice(0, MAX_LIST).map((l) => text(l, 64)),
    };
    if (e.resourceType) v.resourceType = text(e.resourceType, 32) as typeof e.resourceType;
    if (e.statusCode !== undefined) v.statusCode = e.statusCode;
    if (e.frameContext.thirdParty !== undefined) v.thirdParty = e.frameContext.thirdParty;
    return v;
  });

  const ctx: AssistContext = {
    language: input.language,
    productVersion: text(input.productVersion, 32),
    browser: text(input.capabilities.browser, 32),
    capabilities: input.capabilities.capabilities.slice(0, 32).map((c) => text(c, 64)),
    generatedAt: input.now ?? Date.now(),
    hostnames: hostnamesOf(dets, evs),
    referenceHostnames: referenceHostnames(dets),
    detections,
    events,
    timeline: text(input.timeline.text, 4000),
    suggestedActions: input.actions.actions.map((a) => text(a.text)),
  };
  if (input.cluster) ctx.clusterSummary = text(input.cluster.summary, 1000);
  return ctx;
}
