import { fnv1a } from "@adtripwire/shared";
import type { Detection, NormalizedEvent, SanitizedUrl } from "@adtripwire/shared";
import { IDENTIFIER_PARAM_NAMES } from "./identifier-params.js";

export type RedactionProfile = "default" | "strict";

export interface RedactOptions {
  /** Hostnames that stay readable in the strict profile (e.g. detection subject hostnames). */
  keepHostnames: Set<string>;
  /** Salt mixed into pseudonyms. Never export it. */
  salt: string;
  /**
   * Additional hostnames (beyond the keep set) that should be pseudonymised wherever they
   * appear in detection free text. Typically every hostname observed in the exported events.
   */
  extraHostnames?: Iterable<string>;
}

const MAX_QUERY_NAMES = 50;
const MAX_QUERY_NAME_LENGTH = 40;
const MAX_PATH_LENGTH = 200;
const STRICT_PATH_ALLOWLIST: ReadonlySet<string> = new Set(["/getAd", "/cplatform/getAd", "/"]);
const STRICT_PATH_PLACEHOLDER = "/{…}";

/** Stable pseudonym `h-<10 hex chars>` for a hostname under a salt. */
export function pseudonymiseHostname(hostname: string, salt: string): string {
  const h = hostname.toLowerCase();
  // fnv1a yields 8 hex chars; two differently-ordered inputs give the 10+ chars needed.
  const digest = fnv1a(h + salt) + fnv1a(salt + h);
  return "h-" + digest.slice(0, 10);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace every occurrence (case-insensitive, no word-boundary requirement so that
 * embedded hostnames are never left behind) of a known hostname with its pseudonym.
 * Longest hostnames are matched first.
 */
export function pseudonymiseHostnamesInText(
  text: string,
  map: ReadonlyMap<string, string>,
): string {
  if (map.size === 0 || text.length === 0) return text;
  const lowered = new Map<string, string>();
  for (const [host, pseudonym] of map) {
    if (host.length > 0) lowered.set(host.toLowerCase(), pseudonym);
  }
  if (lowered.size === 0) return text;
  const keys = Array.from(lowered.keys()).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const re = new RegExp(keys.map(escapeRegExp).join("|"), "gi");
  return text.replace(re, (m) => lowered.get(m.toLowerCase()) ?? m);
}

/** Defence in depth for free text: drop URL credentials and query values if any slipped in. */
function scrubText(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@?#]*@/gi, "$1")
    .replace(/([?&][^=\s&#?"']+)=[^\s&#"']*/g, "$1");
}

function truncateChars(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join("");
}

function clampDestination(d: SanitizedUrl): SanitizedUrl {
  let redacted = d.redacted;
  const names = Array.from(
    new Set(d.queryParamNames.map((n) => truncateChars(n.toLowerCase(), MAX_QUERY_NAME_LENGTH))),
  )
    .sort()
    .slice(0, MAX_QUERY_NAMES);
  if (names.length !== d.queryParamNames.length) redacted = true;
  let pathPattern = d.pathPattern;
  if (pathPattern.length > MAX_PATH_LENGTH) {
    pathPattern = pathPattern.slice(0, MAX_PATH_LENGTH - 1) + "…";
    redacted = true;
  }
  return { ...d, pathPattern, queryParamNames: names, redacted };
}

function requireStrictOptions(options: Partial<RedactOptions> | undefined): RedactOptions {
  if (!options || typeof options.salt !== "string" || options.salt.length === 0) {
    throw new Error("strict redaction requires a non-empty salt");
  }
  return {
    keepHostnames: options.keepHostnames ?? new Set<string>(),
    salt: options.salt,
    ...(options.extraHostnames !== undefined ? { extraHostnames: options.extraHostnames } : {}),
  };
}

function hostMapper(options: RedactOptions): (host: string) => string {
  const keep = new Set(Array.from(options.keepHostnames, (h) => h.toLowerCase()));
  return (host) =>
    host.length === 0 || keep.has(host.toLowerCase())
      ? host
      : pseudonymiseHostname(host, options.salt);
}

/**
 * Returns a deep copy of the event with the profile applied. The strict profile needs
 * `options.salt` (and normally `options.keepHostnames`).
 */
export function redactEvent(
  e: NormalizedEvent,
  profile: RedactionProfile,
  options?: Partial<RedactOptions>,
): NormalizedEvent {
  const copy = structuredClone(e);
  copy.destination = clampDestination(copy.destination);
  if (profile === "default") return copy;

  const opts = requireStrictOptions(options);
  const mapHost = hostMapper(opts);
  const before = copy.destination;

  const pathPattern = STRICT_PATH_ALLOWLIST.has(before.pathPattern)
    ? before.pathPattern
    : STRICT_PATH_PLACEHOLDER;
  const queryParamNames = before.queryParamNames.filter((n) => IDENTIFIER_PARAM_NAMES.has(n));
  copy.destination = {
    ...before,
    hostname: mapHost(before.hostname),
    pathPattern,
    queryParamNames,
    redacted:
      before.redacted ||
      pathPattern !== before.pathPattern ||
      queryParamNames.length !== before.queryParamNames.length,
  };

  delete copy.initiatorOrigin;
  delete copy.tabId;
  if (copy.redirectHostname !== undefined) copy.redirectHostname = mapHost(copy.redirectHostname);
  if (copy.correlationId !== undefined)
    copy.correlationId = "c-" + pseudonymiseHostname(copy.correlationId, opts.salt).slice(2);

  const fc = copy.frameContext;
  if (fc.documentHostname !== undefined) fc.documentHostname = mapHost(fc.documentHostname);
  if (fc.topHostname !== undefined) fc.topHostname = mapHost(fc.topHostname);
  fc.ancestorHostnames = fc.ancestorHostnames.map(mapHost);
  return copy;
}

function buildTextMap(options: RedactOptions): Map<string, string> {
  const keep = new Set(Array.from(options.keepHostnames, (h) => h.toLowerCase()));
  const map = new Map<string, string>();
  for (const host of options.extraHostnames ?? []) {
    const h = host.toLowerCase();
    if (h.length > 0 && !keep.has(h)) map.set(h, pseudonymiseHostname(h, options.salt));
  }
  return map;
}

/** Returns a deep copy of the detection with the profile applied. */
export function redactDetection(
  d: Detection,
  profile: RedactionProfile,
  options?: Partial<RedactOptions>,
): Detection {
  const copy = structuredClone(d);
  // Exports are English-only: the Norwegian display text is never exported, and under the strict
  // profile it would carry hostnames that were not pseudonymised.
  delete copy.nb;
  const opts = profile === "strict" ? requireStrictOptions(options) : null;

  let transform: (s: string) => string = scrubText;
  if (opts) {
    const keep = new Set(Array.from(opts.keepHostnames, (h) => h.toLowerCase()));
    const map = buildTextMap(opts);
    for (const host of copy.subjectHostnames) {
      const h = host.toLowerCase();
      if (h.length > 0 && !keep.has(h)) map.set(h, pseudonymiseHostname(h, opts.salt));
    }
    transform = (s) => scrubText(pseudonymiseHostnamesInText(s, map));
    const mapHost = hostMapper(opts);
    copy.subjectHostnames = copy.subjectHostnames.map(mapHost);
    delete copy.tabId;
  }

  copy.confidenceRationale = transform(copy.confidenceRationale);
  copy.summary = transform(copy.summary);
  copy.significance = transform(copy.significance);
  copy.dedupKey = transform(copy.dedupKey);
  copy.evidence = copy.evidence.map((item) => ({ ...item, observed: transform(item.observed) }));
  copy.missingVisibility = copy.missingVisibility.map(transform);
  copy.alternativeExplanations = copy.alternativeExplanations.map(transform);
  copy.recommendedActions = copy.recommendedActions.map(transform);
  copy.limitations = copy.limitations.map(transform);
  return copy;
}
