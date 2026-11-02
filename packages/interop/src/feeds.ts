/**
 * Companion rule sets for network sensors, generated from AdTripwire indicator data.
 *
 * Exposure to documented infrastructure is not evidence of compromise; these rules flag
 * traffic for an analyst, they do not establish targeting or infection.
 */
import type { IndicatorRecord, IndicatorSet } from "@adtripwire/shared";
import { isBeforeDay } from "./common.js";

export interface FeedOptions {
  /** Generation time: records whose `validTo` is before this UTC day are excluded. */
  generatedAt: Date;
}

export interface SuricataOptions extends FeedOptions {
  /** First sid (default 9400000). Each record (included or not) reserves 4 consecutive sids. */
  sidBase?: number;
}

export interface ActiveIndicator {
  set: IndicatorSet;
  record: IndicatorRecord;
}

export interface ActiveIndicatorSelection {
  active: ActiveIndicator[];
  excluded: { synthetic: number; disabled: number; expired: number };
}

/** Records eligible for feeds: non-synthetic sets, enabled, not expired at `generatedAt`. */
export function selectFeedIndicators(
  sets: readonly IndicatorSet[],
  generatedAt: Date,
): ActiveIndicatorSelection {
  const active: ActiveIndicator[] = [];
  const excluded = { synthetic: 0, disabled: 0, expired: 0 };
  for (const set of sets) {
    for (const record of set.indicators) {
      if (set.meta.synthetic) excluded.synthetic++;
      else if (!record.enabled) excluded.disabled++;
      else if (record.validTo !== undefined && isBeforeDay(record.validTo, generatedAt))
        excluded.expired++;
      else active.push({ set, record });
    }
  }
  return { active, excluded };
}

// ---------------------------------------------------------------------------------- Zeek

export const ZEEK_INTEL_HEADER =
  "#fields\tindicator\tindicator_type\tmeta.source\tmeta.desc\tmeta.url\tmeta.do_notice";

function zeekField(s: string): string {
  const t = s.replace(/[\t\r\n]+/g, " ").trim();
  return t.length === 0 ? "-" : t;
}

function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join("");
}

/**
 * Zeek Intelligence Framework file. `hostname` and `domain` records become `Intel::DOMAIN`
 * (Zeek matches the exact name only: a `domain` record is emitted as its apex, subdomains are
 * NOT covered). `hostname_path` becomes `Intel::URL` as `host/path` (Zeek compares the whole
 * host+URI, so only requests to exactly that path match). `url_path` records are skipped.
 */
export function toZeekIntel(sets: readonly IndicatorSet[], opts: FeedOptions): string {
  const rows = [ZEEK_INTEL_HEADER];
  for (const { set, record: r } of selectFeedIndicators(sets, opts.generatedAt).active) {
    let indicator: string;
    let type: string;
    if (r.indicatorType === "hostname" || r.indicatorType === "domain") {
      indicator = r.indicator;
      type = "Intel::DOMAIN";
    } else if (r.indicatorType === "hostname_path" && r.pathPattern !== undefined) {
      indicator = `${r.indicator}${r.pathPattern}`;
      type = "Intel::URL";
    } else {
      continue;
    }
    const desc = `${r.classification}/${r.role ?? "unknown"}: ${truncate(r.notes ?? `${r.indicatorType} indicator`, 120)}`;
    rows.push(
      [
        zeekField(indicator),
        type,
        zeekField(`AdTripwire/${set.meta.id}/${r.id} (${r.source})`),
        zeekField(desc),
        zeekField(r.sourceUrl),
        r.classification === "malicious" ? "T" : "F",
      ].join("\t"),
    );
  }
  return rows.join("\n") + "\n";
}

// ------------------------------------------------------------------------------ Suricata

export const DEFAULT_SID_BASE = 9_400_000;

function msgEscape(s: string): string {
  return s.replace(/[\\";]/g, (c) => `\\${c}`);
}

function contentEscape(s: string): string {
  return s.replace(
    /[|";\\]/g,
    (c) => `|${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}|`,
  );
}

function metaValue(s: string): string {
  const v = s
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return truncate(v.length > 0 ? v : "unknown", 64);
}

function referenceValue(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/[\s;"\\]/g, "");
}

/**
 * Suricata rules. `domain` and `hostname` records get three rules (DNS query, TLS SNI, HTTP
 * Host); `domain` uses `dotprefix` + `endswith` (apex and subdomains), `hostname` uses
 * `startswith` + `endswith` (exact). `hostname_path` gets ONE rule (HTTP Host exact + URI
 * prefix): the host alone is shared infrastructure and is not an indicator, so no DNS/SNI rule
 * is emitted, and the rule can only fire on cleartext HTTP. `url_path` gets one URI rule.
 */
export function toSuricataRules(sets: readonly IndicatorSet[], opts: SuricataOptions): string {
  const base = opts.sidBase ?? DEFAULT_SID_BASE;
  const out: string[] = [];
  // sid slots are assigned over ALL records (in set/record order) so that disabling or expiring
  // one record never renumbers the others.
  const slot = new Map<IndicatorRecord, number>();
  let n = 0;
  for (const set of sets) for (const record of set.indicators) slot.set(record, n++);
  const active = selectFeedIndicators(sets, opts.generatedAt).active;
  active.forEach(({ record: r }) => {
    const idx = slot.get(r)!;
    const classtype = r.classification === "malicious" ? "trojan-activity" : "policy-violation";
    const tail = (k: number): string =>
      [
        `classtype:${classtype}`,
        `reference:url,${referenceValue(r.sourceUrl)}`,
        `metadata:adtripwire_classification ${r.classification}, adtripwire_role ${metaValue(r.role ?? "unknown")}, adtripwire_source ${metaValue(r.source)}, adtripwire_id ${metaValue(r.id)}, created_at ${r.firstReported.replace(/-/g, "_")}`,
        `sid:${base + idx * 4 + k}`,
        "rev:1",
      ].join("; ") + ";)";
    const msg = (what: string, proto: string): string =>
      `msg:"${msgEscape(`ADTRIPWIRE ${r.classification} ${what} ${proto}`)}"`;
    const host = contentEscape(r.indicator);

    if (r.indicatorType === "domain" || r.indicatorType === "hostname") {
      const match = (nocase: boolean): string =>
        r.indicatorType === "domain"
          ? `dotprefix; content:".${host}"; ${nocase ? "nocase; " : ""}endswith`
          : `content:"${host}"; ${nocase ? "nocase; " : ""}startswith; endswith`;
      out.push(
        `alert dns any any -> any any (${msg(r.indicator, "DNS")}; dns.query; ${match(true)}; ${tail(0)}`,
      );
      out.push(
        `alert tls any any -> any any (${msg(r.indicator, "TLS SNI")}; flow:established,to_server; tls.sni; ${match(true)}; ${tail(1)}`,
      );
      // http.host is normalised to lower case, so no nocase (lower-case content only).
      out.push(
        `alert http any any -> any any (${msg(r.indicator, "HTTP Host")}; flow:established,to_server; http.host; ${match(false)}; ${tail(2)}`,
      );
    } else if (r.indicatorType === "hostname_path" && r.pathPattern !== undefined) {
      out.push(
        `alert http any any -> any any (${msg(`${r.indicator}${r.pathPattern}`, "HTTP")}; flow:established,to_server; http.host; content:"${host}"; startswith; endswith; http.uri; content:"${contentEscape(r.pathPattern)}"; startswith; ${tail(3)}`,
      );
    } else if (r.indicatorType === "url_path") {
      const path = r.pathPattern ?? r.indicator;
      out.push(
        `alert http any any -> any any (${msg(path, "HTTP URI")}; flow:established,to_server; http.uri; content:"${contentEscape(path)}"; startswith; ${tail(3)}`,
      );
    }
  });
  return out.join("\n") + (out.length > 0 ? "\n" : "");
}
