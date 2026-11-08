/**
 * Documented-host matching and request-outcome bookkeeping for the exposure harness.
 *
 * The harness records, next to what the extension reports, how each request to a documented host
 * ended as seen by the browser's own network log: HTTP status, declared size, the registrable
 * domain a redirect went to, or the network error (name not resolved, connection refused, ...).
 * That separates "the ad stack still points at this host" from "this host still answers".
 * Only hostnames, status codes, sizes and browser error codes are kept; never URLs, query values
 * or bodies.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registrable } from "./registrable.mjs";

/** Most outcome rows kept per site. */
export const OUTCOMES_MAX = 50;
/** Browser network error codes look like "net::ERR_NAME_NOT_RESOLVED" or "NS_ERROR_UNKNOWN_HOST". */
export const ERROR_RE = /^[A-Za-z0-9_:. -]{1,80}$/;

const BUNDLED = fileURLToPath(
  new URL("../../packages/indicators/data/adfection-2026.json", import.meta.url),
);

/**
 * A matcher over the documented hosts that anchor findings: classification surveillance or
 * malicious, enabled, inside their validity window at `now`. Domains match themselves and their
 * subdomains (label boundary); hostnames match exactly. Returns (hostname) => indicator id | null.
 */
export function documentedMatcher({ path = BUNDLED, now = Date.now(), indicators } = {}) {
  const list = indicators ?? JSON.parse(readFileSync(path, "utf8")).indicators ?? [];
  const exact = new Map();
  const suffix = new Map();
  for (const i of list) {
    if (!i?.enabled || !["surveillance", "malicious"].includes(i.classification)) continue;
    if (i.validFrom && Date.parse(i.validFrom) > now) continue;
    if (i.validTo && Date.parse(i.validTo) < now) continue;
    const v = String(i.indicator ?? "").toLowerCase();
    if (!v) continue;
    if (i.indicatorType === "domain") suffix.set(v, i.id);
    else if (i.indicatorType === "hostname" || i.indicatorType === "hostname_path")
      exact.set(v, i.id);
  }
  return (hostname) => {
    const h = String(hostname ?? "")
      .toLowerCase()
      .replace(/\.$/, "");
    if (exact.has(h)) return exact.get(h);
    const labels = h.split(".");
    for (let k = 0; k < labels.length - 1; k++) {
      const s = labels.slice(k).join(".");
      if (suffix.has(s)) return suffix.get(s);
    }
    return null;
  };
}

const bump = (o, k) => {
  o[k] = (o[k] ?? 0) + 1;
};

/** Per-site outcome recorder. Feed it request/response/failure facts; read rows(). */
export function outcomeRecorder(match) {
  const hosts = new Map();
  const entry = (host, id) => {
    let e = hosts.get(host);
    if (!e) {
      e = { host, indicator: id, requests: 0, statuses: {}, failures: {}, redirectTo: new Set() };
      hosts.set(host, e);
    }
    return e;
  };
  const hostOf = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : null;
    } catch {
      return null;
    }
  };
  return {
    /** A request started (redirect hops count as their own request). */
    request(url) {
      const host = hostOf(url);
      const id = host && match(host);
      if (id) entry(host, id).requests += 1;
    },
    /** A response arrived. bytes: declared size when known. location: redirect target URL. */
    response(url, status, { bytes, location } = {}) {
      const host = hostOf(url);
      const id = host && match(host);
      if (!id || !Number.isInteger(status)) return;
      const e = entry(host, id);
      bump(e.statuses, String(status));
      if (Number.isInteger(bytes) && bytes >= 0) e.maxBytes = Math.max(e.maxBytes ?? 0, bytes);
      if (location) {
        let target = null;
        try {
          target = hostOf(new URL(location, url).href);
        } catch {
          /* ignore */
        }
        if (target) e.redirectTo.add(registrable(target));
      }
    },
    /** A redirect hop whose response object was not available (status recorded as "3xx"). */
    redirect(url, location) {
      const host = hostOf(url);
      const id = host && match(host);
      if (!id) return;
      const e = entry(host, id);
      bump(e.statuses, "3xx");
      const target = hostOf(location);
      if (target) e.redirectTo.add(registrable(target));
    },
    /** A request failed with a browser network error code. */
    failure(url, errorText) {
      const host = hostOf(url);
      const id = host && match(host);
      if (!id) return;
      const code =
        typeof errorText === "string" && ERROR_RE.test(errorText) ? errorText : "unknown";
      bump(entry(host, id).failures, code);
    },
    rows() {
      return [...hosts.values()]
        .sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0))
        .slice(0, OUTCOMES_MAX)
        .map((e) => ({
          host: e.host,
          indicator: e.indicator,
          requests: e.requests,
          statuses: e.statuses,
          failures: e.failures,
          ...(e.maxBytes !== undefined ? { maxBytes: e.maxBytes } : {}),
          ...(e.redirectTo.size ? { redirectTo: [...e.redirectTo].sort().slice(0, 10) } : {}),
        }));
    },
  };
}

/** One-line description of an outcome row, e.g. "2 request(s): HTTP 302 x2 -> yandex.ru". */
export function outcomeText(o) {
  const parts = [];
  const st = Object.entries(o.statuses ?? {});
  if (st.length) parts.push(st.map(([s, n]) => `HTTP ${s}${n > 1 ? ` x${n}` : ""}`).join(", "));
  const fl = Object.entries(o.failures ?? {});
  if (fl.length)
    parts.push(`failed: ${fl.map(([e, n]) => `${e}${n > 1 ? ` x${n}` : ""}`).join(", ")}`);
  const answered = st.reduce((a, [, n]) => a + n, 0) + fl.reduce((a, [, n]) => a + n, 0);
  if (o.requests > answered) parts.push(`${o.requests - answered} without a recorded end`);
  let s = `${o.requests} request(s)${parts.length ? ": " + parts.join("; ") : ""}`;
  if (o.maxBytes !== undefined) s += `; largest declared size ${o.maxBytes} B`;
  if (o.redirectTo?.length) s += `; redirected to ${o.redirectTo.join(", ")}`;
  return s;
}
