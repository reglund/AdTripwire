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
/** Most frame hostnames kept per outcome row. */
export const VIA_MAX = 5;
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
  const list = indicators ?? loadIndicators(path);
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

/** The indicator list of a set file (the bundled set by default). */
export function loadIndicators(path = BUNDLED) {
  return JSON.parse(readFileSync(path, "utf8")).indicators ?? [];
}

/**
 * Where a documented host sits in the AdFection chain, from the indicator's role. Stage 1, the ad
 * auction itself, has no indicators: every page with ads takes part in it.
 */
export const STAGES = [
  { n: 1, key: "auction", title: "Ad auction", text: "Every page with ads. Not a finding." },
  {
    n: 2,
    key: "tracking",
    title: "Tracking and ID sync",
    text: "Collects identifiers before any ad is chosen.",
  },
  {
    n: 3,
    key: "selection",
    title: "Ad selection",
    text: "Decides per device: almost everyone gets an empty answer.",
  },
  {
    n: 4,
    key: "delivery",
    title: "Delivery and staging",
    text: "Delivery and logging hosts; the path a selected device's script takes.",
  },
  {
    n: 5,
    key: "spyware",
    title: "Spyware infrastructure",
    text: "Validators, command servers and exploit delivery.",
  },
];

const STAGE_OF_ROLE = {
  tracking: "tracking",
  "operator-infrastructure": "tracking",
  noas: "selection",
  delivery: "delivery",
  staging: "delivery",
  "candiru-attributed": "spyware",
  c2: "spyware",
  "c2-bindecy": "spyware",
  validator: "spyware",
  "sdk-c2": "spyware",
  "profiling-loader": "spyware",
};

/** Stage key for an indicator role; unknown roles of a malicious indicator count as spyware. */
export function stageOf(role, classification) {
  return STAGE_OF_ROLE[role] ?? (classification === "malicious" ? "spyware" : "tracking");
}

const httpHost = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * The frame that issued a request, as { top: true } for the page's own document, { host } for a
 * subframe (the hostname of the frame, or of its nearest ancestor with an http(s) address when the
 * frame has none, as with about:blank ad frames), or null when unknown. Hostnames only.
 * Works with any frame object that has url() and parentFrame().
 */
export function frameOrigin(frame, mainFrame) {
  if (!frame) return null;
  if (frame === mainFrame) return { top: true };
  for (let f = frame, depth = 0; f && depth < 32; f = f.parentFrame(), depth++) {
    const host = httpHost(f.url());
    if (host) return { host };
  }
  return null;
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
      e = {
        host,
        indicator: id,
        requests: 0,
        statuses: {},
        failures: {},
        redirectTo: new Set(),
        via: new Set(),
        fromTop: 0,
      };
      hosts.set(host, e);
    }
    return e;
  };
  const hostOf = httpHost;
  return {
    /**
     * A request started (redirect hops count as their own request). origin: the issuing frame,
     * as for origin(), when already known.
     */
    request(url, originOrFn) {
      const host = hostOf(url);
      const id = host && match(host);
      if (!id) return;
      entry(host, id).requests += 1;
      if (originOrFn !== undefined) this.origin(url, originOrFn);
    },
    /**
     * The frame that issued a request: frameOrigin() output, or a function returning it (called
     * only for documented hosts). Call it when the request ends: Firefox (WebDriver BiDi) can
     * report a new frame's address only after the frame's first requests have started.
     */
    origin(url, originOrFn) {
      const host = hostOf(url);
      const id = host && match(host);
      if (!id) return;
      const e = entry(host, id);
      const origin = typeof originOrFn === "function" ? originOrFn() : originOrFn;
      if (origin?.top === true) e.fromTop += 1;
      else if (typeof origin?.host === "string" && e.via.size < VIA_MAX * 4)
        e.via.add(origin.host.toLowerCase());
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
          ...(e.via.size ? { via: [...e.via].sort().slice(0, VIA_MAX) } : {}),
          ...(e.fromTop ? { fromTop: e.fromTop } : {}),
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
