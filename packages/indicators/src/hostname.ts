/**
 * Hostname normalization and boundary-safe domain matching helpers.
 * Pure functions, no I/O, never throw.
 */

const ALLOWED_ASCII = /^[a-z0-9._-]+$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_CHARS = /^[0-9a-f:.]+$/i;
const HAS_NON_ASCII = /[\u0080-\uffff]/;
const UNICODE_HOST_CHARS = /^[a-z0-9._\-\u0080-\uffff]+$/;

function stripBrackets(host: string): string {
  if (host.length >= 2 && host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function normalizeIpv6(host: string): string | null {
  if (!IPV6_CHARS.test(host) || host.split(":").length < 3) return null;
  try {
    const url = new URL(`http://[${host}]/`);
    const out = stripBrackets(url.hostname);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function validLabels(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  if (!ALLOWED_ASCII.test(host)) return false;
  for (const label of host.split(".")) {
    if (label.length === 0 || label.length > 63) return false;
  }
  return true;
}

/**
 * Normalize a hostname: lower-case, strip a trailing dot, unwrap IPv6 brackets,
 * convert `[.]` defanging to `.`, convert Unicode to punycode. Returns null when invalid.
 */
export function normalizeHostname(input: string): string | null {
  if (typeof input !== "string") return null;
  if (input.length === 0 || /\s/.test(input)) return null;

  let host = input.replace(/\[\.\]/g, ".");
  host = stripBrackets(host).toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.length === 0) return null;

  // IPv6 literal.
  if (host.includes(":")) return normalizeIpv6(host);

  if (HAS_NON_ASCII.test(host)) {
    // Only letters/digits/-/_/. (any script) may reach the URL parser.
    if (!UNICODE_HOST_CHARS.test(host)) return null;
    try {
      host = new URL(`https://${host}`).hostname;
    } catch {
      return null;
    }
    if (host.endsWith(".")) host = host.slice(0, -1);
  }

  return validLabels(host) ? host : null;
}

/** True for IPv4 dotted-quad and IPv6 literals (with or without brackets). */
export function isIpAddress(host: string): boolean {
  if (typeof host !== "string") return false;
  const h = stripBrackets(host);
  if (IPV4.test(h)) return true;
  return h.includes(":") && normalizeIpv6(h.toLowerCase()) !== null;
}

/**
 * True when `hostname` equals `domain` or is a subdomain of it.
 * Boundary-safe: "notmtrtb.com" does not match "mtrtb.com". Inputs are assumed normalized.
 */
export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  if (domain.length === 0) return false;
  if (hostname === domain) return true;
  return hostname.length > domain.length && hostname.endsWith("." + domain);
}

/**
 * The hostname and each parent, excluding the bare TLD.
 * "a.b.c.d" -> ["a.b.c.d", "b.c.d", "c.d"]. A single label yields [].
 */
export function parentDomains(hostname: string): string[] {
  const labels = hostname.split(".");
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) {
    out.push(labels.slice(i).join("."));
  }
  return out;
}
