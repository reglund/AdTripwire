/**
 * STIX 2.1 export of indicator sets and detections.
 *
 * Pattern choices (see README in feeds/ and the package docs):
 *  - `hostname` → `[domain-name:value = 'host']` (exact).
 *  - `domain`   → `[domain-name:value = 'apex']`. STIX patterning has no portable suffix
 *    operator for domain-name, so the pattern names the apex only; the subdomain semantics are
 *    stated in `description` and in the `adtripwire:type:domain` label.
 *  - `hostname_path` / `url_path` → `[url:value MATCHES '<regex>']` with the host and path
 *    regex-escaped and a path-boundary suffix mirroring the matcher.
 * All ids are deterministic (UUIDv5), so repeated exports of the same data are identical.
 */
import type {
  Confidence,
  Detection,
  IndicatorClassification,
  IndicatorRecord,
  IndicatorSet,
  NormalizedEvent,
} from "@adtripwire/shared";
import { EXPORT_DISCLAIMER, SEEN_ALONGSIDE_DISCLAIMER } from "@adtripwire/privacy";
import { applyRedaction, indexIndicators, safePath } from "./common.js";
import type { RedactionChoice } from "./common.js";
import { scoId, stixId } from "./uuid.js";

export { stixToIndicatorSet } from "./stix-import.js";
export type { StixImportOptions, StixImportResult } from "./stix-import.js";

/** Any STIX object. Concrete properties vary by type. */
export interface StixObject {
  type: string;
  id: string;
  spec_version?: "2.1";
  [property: string]: unknown;
}

export interface StixBundle {
  type: "bundle";
  id: string;
  objects: StixObject[];
}

export interface StixExportOptions {
  /** Export time; used for report `published`/`created` and the bundle id. */
  producedAt: Date;
  /** Override the producer identity id (must be `identity--<uuid>`). */
  identityId?: string;
}

export interface StixDetectionExportOptions extends StixExportOptions, RedactionChoice {}

/** Standard TLP 2.0 CLEAR marking definition (referenced, not embedded). */
export const TLP_CLEAR_MARKING_ID = "marking-definition--94868c89-83c2-464b-929b-a1a8aa3c8487";

/** Deterministic id of the AdTripwire project identity. */
export const ADTRIPWIRE_IDENTITY_ID = stixId("identity", "adtripwire-project");

const IDENTITY_CREATED = "2026-10-01T00:00:00.000Z";
const ID_RE = /^[a-z0-9-]+--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CONFIDENCE_SCORE: Record<Confidence, number> = { high: 85, medium: 60, low: 30 };

const INDICATOR_TYPES: Record<IndicatorClassification, string[]> = {
  malicious: ["malicious-activity"],
  surveillance: ["attribution"],
  contextual: ["unknown"],
};

const CLASSIFICATION_TEXT: Record<IndicatorClassification, string> = {
  malicious:
    "Classified malicious: documented as spyware command-and-control, validator or exploit-delivery infrastructure.",
  surveillance:
    "Classified surveillance: ad-delivery or tracking infrastructure operated by the documented actor. Exposure is common; contact alone is not evidence of targeting.",
  contextual:
    "Classified contextual: corporate or attribution-related infrastructure; a lead for an analyst, not a finding.",
};

/** RFC 3339 timestamp with millisecond precision and `Z`. */
export function stixTimestamp(t: number | Date): string {
  return new Date(t).toISOString();
}

function dayStart(day: string): string {
  return `${day}T00:00:00.000Z`;
}

function dayEnd(day: string): string {
  return `${day}T23:59:59.999Z`;
}

/** Escapes a value for a single-quoted STIX pattern string literal. */
export function escapeStixString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathBoundary(path: string): string {
  return path.endsWith("/") ? "" : "(/|\\?|#|$)";
}

/** STIX pattern for an indicator record (null for unsupported records). */
export function stixPatternFor(rec: IndicatorRecord): string | null {
  switch (rec.indicatorType) {
    case "hostname":
    case "domain":
      return `[domain-name:value = '${escapeStixString(rec.indicator)}']`;
    case "hostname_path": {
      if (rec.pathPattern === undefined) return null;
      const re = `^https?://${escapeRegex(rec.indicator)}(:[0-9]+)?${escapeRegex(rec.pathPattern)}${pathBoundary(rec.pathPattern)}`;
      return `[url:value MATCHES '${escapeStixString(re)}']`;
    }
    case "url_path": {
      const path = rec.pathPattern ?? rec.indicator;
      const re = `^https?://[^/]+${escapeRegex(path)}${pathBoundary(path)}`;
      return `[url:value MATCHES '${escapeStixString(re)}']`;
    }
  }
}

/** Deterministic STIX indicator id for an AdTripwire indicator record. */
export function stixIndicatorId(setId: string, indicatorId: string): string {
  return stixId("indicator", `${setId}:${indicatorId}`);
}

function identityObject(id: string): StixObject {
  return {
    type: "identity",
    spec_version: "2.1",
    id,
    created: IDENTITY_CREATED,
    modified: IDENTITY_CREATED,
    name: "AdTripwire",
    identity_class: "system",
    description:
      "AdTripwire: a passive, local-only browser sensor that records observable indicators of advertising-based surveillance and spyware-delivery infrastructure. It does not establish compromise.",
  };
}

function resolveIdentity(opts: StixExportOptions): string {
  if (opts.identityId === undefined) return ADTRIPWIRE_IDENTITY_ID;
  if (!opts.identityId.startsWith("identity--") || !ID_RE.test(opts.identityId)) {
    throw new Error(`identityId must be identity--<uuid>, got ${opts.identityId}`);
  }
  return opts.identityId;
}

function scopeText(rec: IndicatorRecord): string {
  switch (rec.indicatorType) {
    case "domain":
      return `Matches ${rec.indicator} and all of its subdomains. The STIX pattern names the apex only because STIX patterning has no portable subdomain operator for domain-name; consumers should apply subdomain matching.`;
    case "hostname":
      return `Matches the exact hostname ${rec.indicator} only.`;
    case "hostname_path":
      return `Matches the exact hostname ${rec.indicator} with a path starting at ${rec.pathPattern ?? ""} (path boundary). The hostname alone is not an indicator.`;
    case "url_path":
      return `Matches the path prefix ${rec.pathPattern ?? rec.indicator} on any host.`;
  }
}

function indicatorObject(
  set: IndicatorSet,
  rec: IndicatorRecord,
  identityId: string,
): StixObject | null {
  const pattern = stixPatternFor(rec);
  if (pattern === null) return null;
  const created = dayStart(rec.firstReported);
  const modifiedDay = rec.lastReviewed > rec.firstReported ? rec.lastReviewed : rec.firstReported;
  let fromDay = rec.validFrom ?? rec.firstReported;
  if (rec.validTo !== undefined && fromDay > rec.validTo) fromDay = rec.validTo;
  const labels = [
    `adtripwire:${rec.classification}`,
    `adtripwire:type:${rec.indicatorType}`,
    ...(rec.role !== undefined ? [`role:${rec.role}`] : []),
    `campaign:${rec.campaign}`,
  ];
  const description = [scopeText(rec), CLASSIFICATION_TEXT[rec.classification], rec.notes ?? ""]
    .filter((s) => s.length > 0)
    .join(" ");
  const obj: StixObject = {
    type: "indicator",
    spec_version: "2.1",
    id: stixIndicatorId(set.meta.id, rec.id),
    created,
    modified: dayStart(modifiedDay),
    created_by_ref: identityId,
    name:
      rec.indicatorType === "hostname_path"
        ? `${rec.indicator}${rec.pathPattern ?? ""}`
        : rec.indicator,
    description,
    indicator_types: INDICATOR_TYPES[rec.classification],
    pattern,
    pattern_type: "stix",
    pattern_version: "2.1",
    valid_from: dayStart(fromDay),
    labels,
    confidence: CONFIDENCE_SCORE[rec.confidence],
    external_references: [
      { source_name: rec.source, url: rec.sourceUrl },
      { source_name: "adtripwire", external_id: `${set.meta.id}:${rec.id}` },
    ],
    object_marking_refs: [TLP_CLEAR_MARKING_ID],
  };
  if (rec.validTo !== undefined) obj["valid_until"] = dayEnd(rec.validTo);
  return obj;
}

/** One STIX `indicator` per enabled record, plus the AdTripwire identity. */
export function indicatorSetToStix(set: IndicatorSet, opts: StixExportOptions): StixBundle {
  const identityId = resolveIdentity(opts);
  const objects: StixObject[] = [identityObject(identityId)];
  for (const rec of set.indicators) {
    if (!rec.enabled) continue;
    const obj = indicatorObject(set, rec, identityId);
    if (obj) objects.push(obj);
  }
  return {
    type: "bundle",
    id: stixId("bundle", `indicators:${set.meta.id}:${set.meta.version}:${identityId}`),
    objects,
  };
}

function bullets(items: readonly string[]): string {
  return items.length === 0 ? "- (none recorded)" : items.map((s) => `- ${s}`).join("\n");
}

function noteContent(d: Detection, unknownIndicators: string[]): string {
  const parts = [
    `Summary: ${d.summary}`,
    `Significance: ${d.significance}`,
    `Rule: ${d.ruleName} (${d.ruleId} v${d.ruleVersion}), category ${d.category}.`,
    `Severity: ${d.severity} (an investigation priority, not a probability of compromise). Confidence: ${d.confidence}.`,
    `Confidence rationale: ${d.confidenceRationale}`,
    `Evidence:\n${bullets(d.evidence.map((e) => `[${e.kind}] ${e.observed}`))}`,
    `Alternative explanations:\n${bullets(d.alternativeExplanations)}`,
    `Missing visibility:\n${bullets(d.missingVisibility)}`,
    `Limitations:\n${bullets(d.limitations)}`,
    `Recommended actions:\n${bullets(d.recommendedActions)}`,
    `References:\n${bullets(d.references.map((r) => `${r.title}: ${r.url}`))}`,
  ];
  if (unknownIndicators.length > 0) {
    parts.push(
      `Matched indicator ids not present in the supplied indicator sets: ${unknownIndicators.join(", ")}`,
    );
  }
  return parts.join("\n\n");
}

/**
 * STIX bundle for detections: per detection an `observed-data` (with `domain-name` and
 * sanitized `url` SCOs), one `sighting` per matched indicator, and a `note` carrying the
 * analysis text; one `report` references every object. The matched indicator SDOs and the
 * identity are included so the bundle is self-contained.
 */
export function detectionsToStix(
  detections: readonly Detection[],
  events: readonly NormalizedEvent[],
  indicatorSets: readonly IndicatorSet[],
  opts: StixDetectionExportOptions,
): StixBundle {
  const identityId = resolveIdentity(opts);
  const red = applyRedaction(detections, events, opts);
  const eventById = new Map(red.events.map((e) => [e.eventId, e] as const));
  const indicators = indexIndicators(indicatorSets);

  const objects = new Map<string, StixObject>();
  const add = (o: StixObject): void => {
    if (!objects.has(o.id)) objects.set(o.id, o);
  };
  add(identityObject(identityId));
  const indicatorObjs: StixObject[] = [];
  const scos: StixObject[] = [];
  const sdos: StixObject[] = [];

  const sorted = [...red.detections].sort(
    (a, b) => a.timestamp - b.timestamp || (a.detectionId < b.detectionId ? -1 : 1),
  );
  for (const d of sorted) {
    const evs = d.eventIds.map((id) => eventById.get(id)).filter((e) => e !== undefined);
    const times = evs.map((e) => e.timestamp);
    const first =
      times.length > 0 ? Math.min(...times) : Math.min(d.firstEventTimestamp, d.timestamp);
    const last = Math.max(first, times.length > 0 ? Math.max(...times) : d.timestamp);
    const created = stixTimestamp(d.timestamp);
    const count = Math.max(1, d.occurrenceCount);

    const subjects = new Set(
      d.subjectHostnames.map((h) => h.toLowerCase()).filter((h) => h.length > 0),
    );
    const refs: string[] = [];
    for (const host of [...subjects].sort()) {
      const id = scoId("domain-name", { value: host });
      scos.push({ type: "domain-name", spec_version: "2.1", id, value: host });
      refs.push(id);
    }
    for (const e of evs) {
      const dest = e.destination;
      if (!subjects.has(dest.hostname.toLowerCase())) continue;
      if (dest.scheme !== "http" && dest.scheme !== "https") continue;
      const value = `${dest.scheme}://${dest.hostname.toLowerCase()}${dest.port !== undefined ? `:${dest.port}` : ""}${safePath(dest.pathPattern)}`;
      const id = scoId("url", { value });
      if (refs.includes(id)) continue;
      scos.push({ type: "url", spec_version: "2.1", id, value });
      refs.push(id);
    }

    const noteRefs: string[] = [];
    let observedId: string | null = null;
    if (refs.length > 0) {
      observedId = stixId("observed-data", d.detectionId);
      sdos.push({
        type: "observed-data",
        spec_version: "2.1",
        id: observedId,
        created,
        modified: created,
        created_by_ref: identityId,
        first_observed: stixTimestamp(first),
        last_observed: stixTimestamp(last),
        number_observed: count,
        object_refs: refs,
        object_marking_refs: [TLP_CLEAR_MARKING_ID],
      });
      noteRefs.push(observedId);
    }

    const unknown: string[] = [];
    for (const indId of [...new Set(d.matchedIndicatorIds)]) {
      const hit = indicators.get(indId);
      if (!hit) {
        unknown.push(indId);
        continue;
      }
      const ind = indicatorObject(hit.set, hit.record, identityId);
      if (!ind) {
        unknown.push(indId);
        continue;
      }
      if (!indicatorObjs.some((o) => o.id === ind.id)) indicatorObjs.push(ind);
      const sightingId = stixId("sighting", `${d.detectionId}:${ind.id}`);
      const sighting: StixObject = {
        type: "sighting",
        spec_version: "2.1",
        id: sightingId,
        created,
        modified: created,
        created_by_ref: identityId,
        description: d.summary,
        first_seen: stixTimestamp(first),
        last_seen: stixTimestamp(last),
        count,
        sighting_of_ref: ind.id,
        where_sighted_refs: [identityId],
        object_marking_refs: [TLP_CLEAR_MARKING_ID],
      };
      if (observedId !== null) sighting["observed_data_refs"] = [observedId];
      sdos.push(sighting);
      noteRefs.push(sightingId);
    }

    sdos.push({
      type: "note",
      spec_version: "2.1",
      id: stixId("note", d.detectionId),
      created,
      modified: created,
      created_by_ref: identityId,
      abstract: d.summary,
      content: noteContent(d, unknown),
      authors: ["AdTripwire"],
      labels: [`severity:${d.severity}`, `confidence:${d.confidence}`, `rule:${d.ruleId}`],
      object_refs: noteRefs.length > 0 ? noteRefs : [identityId],
      object_marking_refs: [TLP_CLEAR_MARKING_ID],
    });
  }

  for (const o of [...indicatorObjs, ...scos, ...sdos]) add(o);
  const allIds = [...objects.keys()];
  const producedAt = stixTimestamp(opts.producedAt);
  const reportId = stixId(
    "report",
    `${sorted.map((d) => d.detectionId).join(",")}|${producedAt}|${identityId}`,
  );
  add({
    type: "report",
    spec_version: "2.1",
    id: reportId,
    created: producedAt,
    modified: producedAt,
    created_by_ref: identityId,
    name: `AdTripwire detections (${sorted.length})`,
    description: `Observations recorded by the AdTripwire browser sensor: ${sorted.length} detection(s). Severity is an investigation priority, not a probability of compromise. ${EXPORT_DISCLAIMER}`,
    report_types: ["threat-report"],
    published: producedAt,
    object_refs: allIds,
    object_marking_refs: [TLP_CLEAR_MARKING_ID],
  });
  return {
    type: "bundle",
    id: stixId("bundle", `detections:${reportId}`),
    objects: [...objects.values()],
  };
}

/** Structural subset of a "seen alongside" row (the correlation package's `AlongsideRow`). */
export interface StixAlongsideRow {
  hostname: string;
  alongsideDays: number;
  seenDays: number;
  share: number;
  /** AdTripwire indicator ids of the documented hosts it was seen alongside. */
  anchors: readonly string[];
  /** Newest UTC day key, YYYY-MM-DD. */
  lastSeen: string;
}

const ALONGSIDE_HOST = /^[a-z0-9]([a-z0-9._-]{0,251}[a-z0-9])?$/;
const ALONGSIDE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Adds "seen alongside" candidates to a bundle: per row one `observed-data` plus a
 * `domain-name` SCO, and a `related-to` relationship to the anchor's indicator SDO for every
 * anchor whose indicator is already in the bundle. Never creates an `indicator`: a candidate is
 * an observation, not an indicator. Rows with a malformed hostname or day are skipped, so only
 * hostnames ever leave. Returns the bundle (mutated) for chaining.
 */
export function addAlongsideToStix(
  bundle: StixBundle,
  rows: readonly StixAlongsideRow[],
  indicatorSets: readonly IndicatorSet[],
  opts: StixExportOptions,
): StixBundle {
  const valid = rows.filter(
    (r) =>
      ALONGSIDE_HOST.test(r.hostname) &&
      ALONGSIDE_DAY.test(r.lastSeen) &&
      r.alongsideDays > 0 &&
      r.hostname.includes("."),
  );
  if (valid.length === 0) return bundle;
  const identityId = resolveIdentity(opts);
  const present = new Set(bundle.objects.map((o) => o.id));
  const indicators = indexIndicators(indicatorSets);
  const modified = stixTimestamp(opts.producedAt);
  const added: StixObject[] = [];
  const add = (o: StixObject): void => {
    if (present.has(o.id)) return;
    present.add(o.id);
    added.push(o);
  };
  if (!present.has(identityId)) add(identityObject(identityId));
  for (const row of [...valid].sort((a, b) => (a.hostname < b.hostname ? -1 : 1))) {
    const created = dayStart(row.lastSeen) < modified ? dayStart(row.lastSeen) : modified;
    const scoRef = scoId("domain-name", { value: row.hostname });
    add({ type: "domain-name", spec_version: "2.1", id: scoRef, value: row.hostname });
    const observedId = stixId("observed-data", `alongside:${row.hostname}`);
    add({
      type: "observed-data",
      spec_version: "2.1",
      id: observedId,
      created,
      modified,
      created_by_ref: identityId,
      first_observed: dayStart(row.lastSeen),
      last_observed: dayEnd(row.lastSeen),
      number_observed: 1,
      object_refs: [scoRef],
      labels: ["adtripwire:seen-alongside"],
      object_marking_refs: [TLP_CLEAR_MARKING_ID],
      x_adtripwire_note: `Observation, not an indicator. ${SEEN_ALONGSIDE_DISCLAIMER}`,
      x_adtripwire_alongside_days: row.alongsideDays,
      x_adtripwire_seen_days: row.seenDays,
      x_adtripwire_share: Math.round(row.share * 1000) / 1000,
    });
    const description = [
      `An observation, not an indicator: ${row.hostname} appeared in the same ad frame as a documented host on ${row.alongsideDays} of ${row.seenDays} days it was seen (most recent ${row.lastSeen}).`,
      SEEN_ALONGSIDE_DISCLAIMER,
    ].join(" ");
    for (const anchorId of [...new Set(row.anchors)].sort()) {
      const hit = indicators.get(anchorId);
      if (!hit) continue;
      const targetId = stixIndicatorId(hit.setId, hit.record.id);
      if (!present.has(targetId)) continue;
      add({
        type: "relationship",
        spec_version: "2.1",
        id: stixId("relationship", `${observedId}:related-to:${targetId}`),
        created,
        modified,
        created_by_ref: identityId,
        relationship_type: "related-to",
        source_ref: observedId,
        target_ref: targetId,
        description,
        object_marking_refs: [TLP_CLEAR_MARKING_ID],
      });
    }
  }
  bundle.objects.push(...added);
  for (const o of bundle.objects) {
    if (o.type !== "report" || !Array.isArray(o["object_refs"])) continue;
    const refs = o["object_refs"] as string[];
    for (const a of added) if (!refs.includes(a.id)) refs.push(a.id);
  }
  return bundle;
}
