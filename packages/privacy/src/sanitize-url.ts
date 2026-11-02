import type { SanitizedUrl } from "@adtripwire/shared";

const MAX_QUERY_NAMES = 50;
const MAX_QUERY_NAME_LENGTH = 40;
const MAX_PATH_LENGTH = 200;
const MAX_SAFE_SEGMENT_LENGTH = 32;

const SAFE_SEGMENT = /^[a-z0-9_\-.]+$/i;
const HEX_TOKEN = /^[0-9a-f]{16,}$/i;
const BASE64URL_TOKEN = /^[A-Za-z0-9_-]{20,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEME_NAME = /^[a-z][a-z0-9+.-]{0,31}$/;

/**
 * Deterministic token-likeness checks. A segment that matches any of these is
 * replaced by `{id}` rather than kept verbatim.
 */
function isTokenLike(segment: string): boolean {
  if (HEX_TOKEN.test(segment)) return true;
  if (BASE64URL_TOKEN.test(segment)) return true;
  if (UUID.test(segment)) return true;
  if (segment.length >= 8) {
    let digits = 0;
    for (let i = 0; i < segment.length; i++) {
      const c = segment.charCodeAt(i);
      if (c >= 48 && c <= 57) digits++;
    }
    if (digits / segment.length >= 0.5) return true;
  }
  // Key=value style path parameters (e.g. ";jsessionid=...") carry values.
  if (segment.includes("=")) return true;
  return false;
}

/** Returns the placeholder for a segment, or null when it is safe to keep verbatim. */
function segmentPlaceholder(segment: string): "{id}" | "{seg}" | null {
  if (isTokenLike(segment)) return "{id}";
  if (segment.length > MAX_SAFE_SEGMENT_LENGTH || !SAFE_SEGMENT.test(segment)) return "{seg}";
  return null;
}

function stripTrailingDot(host: string): string {
  let h = host;
  while (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

function normalizeHostname(host: string): string {
  return stripTrailingDot(host.toLowerCase());
}

function truncateChars(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join("");
}

function safeDecode(s: string): string {
  const plusDecoded = s.replace(/\+/g, " ");
  try {
    return decodeURIComponent(plusDecoded);
  } catch {
    return plusDecoded;
  }
}

function mapScheme(protocol: string): SanitizedUrl["scheme"] {
  switch (protocol) {
    case "http:":
      return "http";
    case "https:":
      return "https";
    case "ws:":
      return "ws";
    case "wss:":
      return "wss";
    default:
      return "other";
  }
}

function sanitizePath(pathname: string): { pattern: string; redacted: boolean } {
  let redacted = false;
  const rawSegments = pathname.split("/").filter((s) => s.length > 0);
  const out: string[] = [];
  for (const seg of rawSegments) {
    const placeholder = segmentPlaceholder(seg);
    if (placeholder === null) {
      out.push(seg);
    } else {
      out.push(placeholder);
      redacted = true;
    }
  }
  let pattern = "/" + out.join("/");
  if (out.length > 0 && pathname.endsWith("/")) pattern += "/";
  if (pattern.length > MAX_PATH_LENGTH) {
    pattern = pattern.slice(0, MAX_PATH_LENGTH - 1) + "…";
    redacted = true;
  }
  return { pattern, redacted };
}

function sanitizeQuery(search: string): { names: string[]; redacted: boolean } {
  let redacted = false;
  const names = new Set<string>();
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (query.length === 0) return { names: [], redacted };
  for (const part of query.split("&")) {
    if (part.length === 0) continue;
    const eq = part.indexOf("=");
    const rawName = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    if (rawValue.length > 0) redacted = true; // a value existed and was dropped
    const decoded = safeDecode(rawName).toLowerCase();
    if (decoded.length === 0) continue;
    // A token passed as a bare "name" (e.g. ?5f4dcc3b…) would otherwise survive sanitization.
    if (isTokenLike(decoded)) {
      names.add("{token}");
      redacted = true;
      continue;
    }
    const name = truncateChars(decoded, MAX_QUERY_NAME_LENGTH);
    if (name !== decoded) redacted = true;
    names.add(name);
  }
  let sorted = Array.from(names).sort();
  if (sorted.length > MAX_QUERY_NAMES) {
    sorted = sorted.slice(0, MAX_QUERY_NAMES);
    redacted = true;
  }
  return { names: sorted, redacted };
}

/**
 * Reduce a raw URL to a privacy-safe structural description. Never retains
 * userinfo, query values, or fragments; token-like path segments are replaced
 * by placeholders. Returns null if the input cannot be parsed or has no host.
 */
export function sanitizeUrl(raw: string): SanitizedUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const hostname = normalizeHostname(url.hostname);
  if (hostname.length === 0) return null;

  let redacted = false;
  if (url.username.length > 0 || url.password.length > 0) redacted = true;
  if (url.hash.length > 1) redacted = true;

  const path = sanitizePath(url.pathname);
  const query = sanitizeQuery(url.search);
  if (path.redacted || query.redacted) redacted = true;

  const result: SanitizedUrl = {
    scheme: mapScheme(url.protocol),
    hostname,
    pathPattern: path.pattern,
    queryParamNames: query.names,
    redacted,
  };
  if (url.port.length > 0) {
    const port = Number(url.port);
    if (Number.isInteger(port)) result.port = port;
  }
  return result;
}

/** Display form with query parameter names only, e.g. `https://noas.mtrtb.com/getAd?idfa&ipv4`. */
export function sanitizedUrlToString(u: SanitizedUrl): string {
  const port = u.port !== undefined ? `:${u.port}` : "";
  const query = u.queryParamNames.length > 0 ? `?${u.queryParamNames.join("&")}` : "";
  return `${u.scheme}://${u.hostname}${port}${u.pathPattern}${query}`;
}

/** `scheme://host[:port]` (default ports omitted), or null when unparseable / hostless. */
export function originOf(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const hostname = normalizeHostname(url.hostname);
  if (hostname.length === 0) return null;
  const proto = url.protocol.replace(/:$/, "").toLowerCase();
  const scheme = SCHEME_NAME.test(proto) ? proto : "other";
  const port = url.port.length > 0 ? `:${url.port}` : "";
  return `${scheme}://${hostname}${port}`;
}

/** Lower-cased hostname without trailing dot, or null. */
export function hostnameOf(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const hostname = normalizeHostname(url.hostname);
  return hostname.length === 0 ? null : hostname;
}
