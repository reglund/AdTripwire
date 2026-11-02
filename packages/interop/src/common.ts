import type { Detection, IndicatorRecord, IndicatorSet, NormalizedEvent } from "@adtripwire/shared";
import { redactDetection, redactEvent } from "@adtripwire/privacy";
import type { RedactionProfile } from "@adtripwire/privacy";

/** Options shared by the detection exporters for applying a privacy redaction profile. */
export interface RedactionChoice {
  /**
   * Redaction profile applied before serialisation, exactly as in the evidence export.
   * "default" (the default) scrubs free text; "strict" also pseudonymises hostnames that are
   * not detection subjects. Events are assumed already sanitized by the sensor either way.
   */
  profile?: RedactionProfile;
  /** Salt for strict-profile pseudonyms. A random one is generated when omitted. Never exported. */
  salt?: string;
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function eventHostnames(events: readonly NormalizedEvent[]): Set<string> {
  const hosts = new Set<string>();
  const add = (h: string | undefined): void => {
    if (h !== undefined && h.length > 0) hosts.add(h.toLowerCase());
  };
  for (const e of events) {
    add(e.destination.hostname);
    add(e.redirectHostname);
    add(e.frameContext.documentHostname);
    add(e.frameContext.topHostname);
    e.frameContext.ancestorHostnames.forEach(add);
  }
  return hosts;
}

/** Applies the chosen redaction profile to detections and events (deep copies). */
export function applyRedaction(
  detections: readonly Detection[],
  events: readonly NormalizedEvent[],
  choice: RedactionChoice,
): { detections: Detection[]; events: NormalizedEvent[] } {
  const profile: RedactionProfile = choice.profile ?? "default";
  const keepHostnames = new Set<string>();
  for (const d of detections)
    for (const h of d.subjectHostnames) keepHostnames.add(h.toLowerCase());
  const options = {
    keepHostnames,
    salt: choice.salt !== undefined && choice.salt.length > 0 ? choice.salt : randomSalt(),
    extraHostnames: eventHostnames(events),
  };
  return {
    detections: detections.map((d) => redactDetection(d, profile, options)),
    events: events.map((e) => redactEvent(e, profile, options)),
  };
}

/** Lookup of indicator records by AdTripwire indicator id across sets (first set wins). */
export function indexIndicators(
  sets: readonly IndicatorSet[],
): Map<string, { setId: string; record: IndicatorRecord; set: IndicatorSet }> {
  const map = new Map<string, { setId: string; record: IndicatorRecord; set: IndicatorSet }>();
  for (const set of sets) {
    for (const record of set.indicators) {
      if (!map.has(record.id)) map.set(record.id, { setId: set.meta.id, record, set });
    }
  }
  return map;
}

/** Path pattern made safe for a URL-shaped string: never a query, fragment or `=`-pair. */
export function safePath(pathPattern: string): string {
  let p = pathPattern;
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);
  if (!p.startsWith("/")) p = "/" + p;
  return encodeURI(p).replace(/[=&;]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Is `day` (YYYY-MM-DD) strictly before the UTC calendar day of `at`? */
export function isBeforeDay(day: string, at: Date): boolean {
  return day < at.toISOString().slice(0, 10);
}

/** Path pattern for a `url.path`-style field: query/fragment cut, `=`, `&`, `;` percent-encoded. */
export function pathOnly(pathPattern: string): string {
  let p = pathPattern;
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);
  if (!p.startsWith("/")) p = "/" + p;
  return p.replace(/[=&;]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
