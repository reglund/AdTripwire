import type {
  Confidence,
  IndicatorClassification,
  IndicatorRecord,
  IndicatorSet,
  IndicatorSetMeta,
  IndicatorType,
} from "@adtripwire/shared";
import { isIpAddress, normalizeHostname } from "./hostname.js";

/**
 * Names that are shared hosting / CDN / cloud platforms. An indicator may never BE one of these
 * (a `hostname` may be a subdomain of one, since that identifies a single tenant).
 */
export const BROAD_DOMAIN_DENYLIST: readonly string[] = [
  "cloudfront.net",
  "amazonaws.com",
  "azure.com",
  "herokuapp.com",
  "cloudapp.azure.com",
  "github.io",
  "googleapis.com",
  "akamaihd.net",
  "edgekey.net",
  "fastly.net",
  "netlify.app",
  "vercel.app",
  "web.app",
  "firebaseapp.com",
];

export type ValidationResult = { ok: true; set: IndicatorSet } | { ok: false; errors: string[] };

const TYPES: readonly IndicatorType[] = ["hostname", "domain", "url_path", "hostname_path"];
const CLASSES: readonly IndicatorClassification[] = ["malicious", "surveillance", "contextual"];
const CONFIDENCES: readonly Confidence[] = ["low", "medium", "high"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function validateMeta(raw: unknown, errors: string[]): IndicatorSetMeta | null {
  if (!isObject(raw)) {
    errors.push("meta: must be an object");
    return null;
  }
  const before = errors.length;
  const err = (m: string): void => {
    errors.push(`meta.${m}`);
  };
  for (const k of ["id", "name", "version", "license"] as const) {
    if (!isNonEmptyString(raw[k])) err(`${k}: required non-empty string`);
  }
  if (!isIsoDate(raw["asOf"])) err("asOf: must be a valid YYYY-MM-DD date");
  if (typeof raw["synthetic"] !== "boolean") err("synthetic: must be a boolean");
  if (raw["description"] !== undefined && typeof raw["description"] !== "string") {
    err("description: must be a string when present");
  }
  const sources: IndicatorSetMeta["sources"] = [];
  if (!Array.isArray(raw["sources"])) {
    err("sources: must be an array");
  } else {
    raw["sources"].forEach((s: unknown, i: number) => {
      if (!isObject(s)) {
        err(`sources[${i}]: must be an object`);
        return;
      }
      if (!isNonEmptyString(s["name"])) err(`sources[${i}].name: required non-empty string`);
      if (!isNonEmptyString(s["url"])) err(`sources[${i}].url: required non-empty string`);
      if (!isIsoDate(s["published"]))
        err(`sources[${i}].published: must be a valid YYYY-MM-DD date`);
      if (isNonEmptyString(s["name"]) && isNonEmptyString(s["url"]) && isIsoDate(s["published"])) {
        sources.push({ name: s["name"], url: s["url"], published: s["published"] });
      }
    });
  }
  if (errors.length > before) return null;
  const meta: IndicatorSetMeta = {
    id: raw["id"] as string,
    name: raw["name"] as string,
    version: raw["version"] as string,
    asOf: raw["asOf"] as string,
    license: raw["license"] as string,
    synthetic: raw["synthetic"] as boolean,
    sources,
  };
  if (typeof raw["description"] === "string") meta.description = raw["description"];
  return meta;
}

function validateRecord(raw: unknown, index: number, errors: string[]): IndicatorRecord | null {
  if (!isObject(raw)) {
    errors.push(`indicators[${index}]: must be an object`);
    return null;
  }
  const label = `indicators[${index}]${typeof raw["id"] === "string" ? ` (${raw["id"]})` : ""}`;
  const before = errors.length;
  const err = (m: string): void => {
    errors.push(`${label}: ${m}`);
  };

  for (const k of ["id", "source", "sourceUrl", "campaign"] as const) {
    if (!isNonEmptyString(raw[k])) err(`${k}: required non-empty string`);
  }
  const type = raw["indicatorType"];
  const typeOk = typeof type === "string" && (TYPES as readonly string[]).includes(type);
  if (!typeOk) err(`indicatorType: must be one of ${TYPES.join(", ")}`);
  if (
    typeof raw["classification"] !== "string" ||
    !(CLASSES as readonly string[]).includes(raw["classification"])
  ) {
    err(`classification: must be one of ${CLASSES.join(", ")}`);
  }
  if (
    typeof raw["confidence"] !== "string" ||
    !(CONFIDENCES as readonly string[]).includes(raw["confidence"])
  ) {
    err(`confidence: must be one of ${CONFIDENCES.join(", ")}`);
  }
  if (!isIsoDate(raw["firstReported"])) err("firstReported: must be a valid YYYY-MM-DD date");
  if (!isIsoDate(raw["lastReviewed"])) err("lastReviewed: must be a valid YYYY-MM-DD date");
  if (typeof raw["enabled"] !== "boolean") err("enabled: must be a boolean");
  for (const k of ["notes", "role"] as const) {
    if (raw[k] !== undefined && typeof raw[k] !== "string")
      err(`${k}: must be a string when present`);
  }

  // Indicator value.
  let indicator: string | null = null;
  const rawIndicator = raw["indicator"];
  if (typeof rawIndicator !== "string" || rawIndicator.length === 0) {
    err("indicator: required non-empty string");
  } else if (typeOk && type === "url_path") {
    if (!rawIndicator.startsWith("/")) err('indicator: url_path indicator must start with "/"');
    else indicator = rawIndicator;
  } else if (typeOk) {
    const host = normalizeHostname(rawIndicator);
    if (host === null) {
      err(`indicator: "${rawIndicator}" is not a valid hostname`);
    } else {
      indicator = host;
      if (isIpAddress(host)) {
        err(`indicator: IP addresses are not allowed for ${String(type)} indicators`);
      } else if (!host.includes(".")) {
        err(`indicator: "${host}" must contain at least one dot (bare TLD / single label)`);
      } else if (BROAD_DOMAIN_DENYLIST.includes(host)) {
        err(`indicator: "${host}" is too broad (shared hosting / CDN / cloud platform)`);
      }
    }
  }

  // Path pattern.
  const pp = raw["pathPattern"];
  if (pp !== undefined && typeof pp !== "string") {
    err("pathPattern: must be a string when present");
  } else if (typeOk && (type === "hostname_path" || type === "url_path")) {
    if (typeof pp !== "string" || !pp.startsWith("/")) {
      err(`pathPattern: required and must start with "/" for ${String(type)}`);
    }
  }

  if (errors.length > before || indicator === null) return null;
  const rec: IndicatorRecord = {
    id: raw["id"] as string,
    indicator,
    indicatorType: type as IndicatorType,
    source: raw["source"] as string,
    sourceUrl: raw["sourceUrl"] as string,
    campaign: raw["campaign"] as string,
    classification: raw["classification"] as IndicatorClassification,
    confidence: raw["confidence"] as Confidence,
    firstReported: raw["firstReported"] as string,
    lastReviewed: raw["lastReviewed"] as string,
    enabled: raw["enabled"] as boolean,
  };
  if (typeof pp === "string") rec.pathPattern = pp;
  if (typeof raw["notes"] === "string") rec.notes = raw["notes"];
  if (typeof raw["role"] === "string") rec.role = raw["role"];
  return rec;
}

/** Structural validation of an untrusted indicator set. Collects all errors. */
export function validateIndicatorSet(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ["set: must be an object"] };

  const meta = validateMeta(input["meta"], errors);
  const records: IndicatorRecord[] = [];
  const rawList = input["indicators"];
  if (!Array.isArray(rawList)) {
    errors.push("indicators: must be an array");
  } else {
    const seen = new Set<string>();
    rawList.forEach((r: unknown, i: number) => {
      const rec = validateRecord(r, i, errors);
      if (rec) records.push(rec);
      const id = isObject(r) ? r["id"] : undefined;
      if (typeof id === "string" && id.length > 0) {
        if (seen.has(id)) errors.push(`indicators[${i}] (${id}): duplicate id`);
        seen.add(id);
      }
    });
  }

  if (errors.length > 0 || meta === null) return { ok: false, errors };
  return { ok: true, set: { meta, indicators: records } };
}
