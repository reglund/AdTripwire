/**
 * The public observatory's host table, bundled at build time (like the indicator set) so the
 * Exposure view can say what generic automated profiles saw for a documented host. No network:
 * the data is a JSON file in the bundle, refreshed per release by
 * `scripts/refresh-observatory-snapshot.mjs`. A host that is absent says nothing either way.
 * This module returns structured values only; the UI owns the wording and the translation.
 */
import { normalizeHostname, isIpAddress, parentDomains } from "@adtripwire/indicators";
import snapshotJson from "../data/observatory-snapshot.json";

export const OBSERVATORY_MAX_HOSTS = 500;
export const OBSERVATORY_MAX_SITES = 10;
export const OBSERVATORY_URL = "https://reglund.github.io/adtripwire-observatory/";

export interface ObservatoryHost {
  host: string;
  first: string;
  last: string;
  /** Number of measured days on which the host was seen. */
  days: number;
  /** Number of runs in which the host was seen. */
  runs: number;
  /** Mainstream sites on which it was seen (at most 10). */
  sites: string[];
  variants: number;
  rigs: number;
}

export interface ObservatorySnapshot {
  schemaVersion: 1;
  source: string;
  generatedAt: string;
  period: { from: string; to: string; days: number };
  rigs: number;
  runs: number;
  hosts: ObservatoryHost[];
}

export interface ObservatorySummary {
  /** Last measured day (YYYY-MM-DD): "data as of". */
  asOf: string;
  from: string;
  to: string;
  /** Measured days in the period. */
  days: number;
  rigs: number;
  runs: number;
  hosts: number;
}

export type ObservatoryValidation =
  { ok: true; snapshot: ObservatorySnapshot } | { ok: false; errors: string[] };

const RESERVED_TLD = /(^|\.)(test|invalid|example|localhost)$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function hostnameProblem(v: unknown): string | null {
  if (typeof v !== "string") return "is not a string";
  const norm = normalizeHostname(v);
  if (norm === null || norm !== v) return "is not a normalized hostname";
  if (isIpAddress(v)) return "is an IP address";
  if (!v.includes(".")) return "has no dot";
  if (RESERVED_TLD.test(v)) return "uses a reserved name (.test, .invalid, .example, .localhost)";
  return null;
}

/** Strict validation; never throws. Reserved TLDs are rejected so no synthetic name ships. */
export function validateObservatorySnapshot(raw: unknown): ObservatoryValidation {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["snapshot is not an object"] };
  if (raw["schemaVersion"] !== 1) errors.push("schemaVersion must be 1");
  const source = raw["source"];
  if (typeof source !== "string" || !/^https:\/\/[^\s]+$/.test(source)) {
    errors.push("source must be an https URL");
  }
  const generatedAt = raw["generatedAt"];
  if (typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) {
    errors.push("generatedAt must be an ISO timestamp");
  }
  const period = raw["period"];
  if (!isObj(period)) {
    errors.push("period must be an object");
  } else {
    if (!isDate(period["from"])) errors.push("period.from must be a valid YYYY-MM-DD date");
    if (!isDate(period["to"])) errors.push("period.to must be a valid YYYY-MM-DD date");
    if (isDate(period["from"]) && isDate(period["to"]) && period["from"] > period["to"]) {
      errors.push("period.from must not be after period.to");
    }
    if (!isCount(period["days"])) errors.push("period.days must be a non-negative integer");
  }
  if (!isCount(raw["rigs"])) errors.push("rigs must be a non-negative integer");
  if (!isCount(raw["runs"])) errors.push("runs must be a non-negative integer");

  const hosts = raw["hosts"];
  if (!Array.isArray(hosts)) {
    errors.push("hosts must be an array");
  } else {
    if (hosts.length > OBSERVATORY_MAX_HOSTS) {
      errors.push(`more than ${OBSERVATORY_MAX_HOSTS} hosts`);
    }
    const seen = new Set<string>();
    hosts.forEach((entry: unknown, i) => {
      const where = `hosts[${i}]`;
      if (!isObj(entry)) {
        errors.push(`${where} is not an object`);
        return;
      }
      const problem = hostnameProblem(entry["host"]);
      if (problem) errors.push(`${where}.host ${problem}`);
      else if (seen.has(entry["host"] as string)) errors.push(`${where}.host is a duplicate`);
      else seen.add(entry["host"] as string);
      for (const key of ["first", "last"]) {
        if (!isDate(entry[key])) errors.push(`${where}.${key} must be a valid YYYY-MM-DD date`);
      }
      if (isDate(entry["first"]) && isDate(entry["last"]) && entry["first"] > entry["last"]) {
        errors.push(`${where}.first must not be after .last`);
      }
      for (const key of ["days", "runs", "variants", "rigs"]) {
        if (!isCount(entry[key])) errors.push(`${where}.${key} must be a non-negative integer`);
      }
      const sites = entry["sites"];
      if (!Array.isArray(sites)) {
        errors.push(`${where}.sites must be an array`);
      } else {
        if (sites.length > OBSERVATORY_MAX_SITES) {
          errors.push(`${where}.sites has more than ${OBSERVATORY_MAX_SITES} entries`);
        }
        sites.forEach((s: unknown, j) => {
          const p = hostnameProblem(s);
          if (p) errors.push(`${where}.sites[${j}] ${p}`);
        });
      }
    });
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, snapshot: raw as unknown as ObservatorySnapshot };
}

function loadValidated(raw: unknown): ObservatorySnapshot {
  const result = validateObservatorySnapshot(raw);
  if (!result.ok) {
    throw new Error(`Bundled observatory snapshot is invalid:\n${result.errors.join("\n")}`);
  }
  return result.snapshot;
}

/** The bundled snapshot. Throws at load time if invalid. */
export const BUNDLED_OBSERVATORY: ObservatorySnapshot = loadValidated(snapshotJson);

const BY_HOST = new Map(BUNDLED_OBSERVATORY.hosts.map((e) => [e.host, e] as const));

/**
 * What the observatory saw for a host: the exact host first, then the nearest parent domain
 * that is in the table (boundary-safe: `a.b.example` finds `b.example`, `xb.example` does not).
 * Null when it was not seen, which says nothing either way.
 */
export function observatoryLookup(
  host: string,
  snapshot: ObservatorySnapshot = BUNDLED_OBSERVATORY,
): ObservatoryHost | null {
  const norm = normalizeHostname(host);
  if (norm === null) return null;
  const table =
    snapshot === BUNDLED_OBSERVATORY
      ? BY_HOST
      : new Map(snapshot.hosts.map((e) => [e.host, e] as const));
  for (const candidate of parentDomains(norm)) {
    const hit = table.get(candidate);
    if (hit) return hit;
  }
  return null;
}

export function observatorySummary(
  snapshot: ObservatorySnapshot = BUNDLED_OBSERVATORY,
): ObservatorySummary {
  return {
    asOf: snapshot.period.to,
    from: snapshot.period.from,
    to: snapshot.period.to,
    days: snapshot.period.days,
    rigs: snapshot.rigs,
    runs: snapshot.runs,
    hosts: snapshot.hosts.length,
  };
}
