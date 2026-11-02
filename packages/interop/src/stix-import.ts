/**
 * Import of STIX 2.1 bundles into an AdTripwire indicator set.
 *
 * Supported: `indicator` objects with `pattern_type: "stix"` whose pattern is a single
 * `domain-name:value = '…'` comparison or an OR of such comparisons. Every other pattern
 * (IP addresses, file hashes, URL regexes, AND/qualifiers, …) is skipped with a warning.
 *
 * Matching choice: an imported domain-name becomes a `domain` record, i.e. it matches the
 * name AND all of its subdomains. STIX `domain-name:value =` is strictly an exact comparison,
 * but feeds conventionally list the registered or operational name and expect subdomains to be
 * covered; the validator still rejects shared-hosting / CDN apexes (e.g. `cloudfront.net`), so
 * suffix matching cannot widen to a whole platform. AdTripwire's own exports carry the label
 * `adtripwire:type:hostname` for exact records, which is honoured here.
 */
import type {
  Confidence,
  IndicatorClassification,
  IndicatorRecord,
  IndicatorSet,
  IndicatorSetMeta,
} from "@adtripwire/shared";
import {
  BROAD_DOMAIN_DENYLIST,
  hostnameMatchesDomain,
  validateIndicatorSet,
} from "@adtripwire/indicators";

export interface StixImportOptions {
  setId: string;
  name: string;
  license: string;
}

export type StixImportResult =
  { ok: true; set: IndicatorSet; warnings: string[] } | { ok: false; errors: string[] };

const MAX_OBJECTS = 100_000;
const MAX_PATTERN_LENGTH = 8_192;
const MAX_TEXT = 500;
const MAX_LABEL = 100;
const MAX_WARNINGS_PER_KIND = 20;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max = MAX_TEXT): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length === 0) return undefined;
  const chars = Array.from(t);
  return chars.length <= max ? t : chars.slice(0, max).join("");
}

/** YYYY-MM-DD of an RFC 3339 timestamp, or undefined when not parseable. */
function day(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(v);
  if (!m) return undefined;
  const d = new Date(`${m[1]}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[1] ? m[1] : undefined;
}

const TERM = /^domain-name:value\s*=\s*'((?:[^'\\]|\\.)*)'/;

/**
 * Parses `[domain-name:value = 'a' OR domain-name:value = 'b']` (also `[…] OR […]`).
 * Returns the values, or null when the pattern uses anything else.
 */
export function parseDomainPattern(pattern: string): string[] | null {
  if (pattern.length > MAX_PATTERN_LENGTH) return null;
  let rest = pattern.trim();
  const values: string[] = [];
  let open = false;
  for (;;) {
    if (!open) {
      if (!rest.startsWith("[")) return null;
      rest = rest.slice(1).trimStart();
      open = true;
    }
    const m = TERM.exec(rest);
    if (!m) return null;
    values.push(m[1]!.replace(/\\(.)/g, "$1"));
    rest = rest.slice(m[0].length).trimStart();
    if (rest.startsWith("]")) {
      rest = rest.slice(1).trimStart();
      open = false;
      if (rest.length === 0) break;
    }
    const or = /^OR\s+/.exec(rest);
    if (!or) return null;
    rest = rest.slice(or[0].length);
  }
  return values.length > 0 ? values : null;
}

function patternKind(pattern: unknown): string {
  if (typeof pattern !== "string") return "missing pattern";
  const m = /^\s*\[\s*([a-z0-9-]+):/.exec(pattern);
  return m ? m[1]! : "unparseable pattern";
}

function labelsOf(o: Obj): string[] {
  const raw = o["labels"];
  return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === "string") : [];
}

function labelValue(labels: string[], prefix: string): string | undefined {
  const l = labels.find((x) => x.startsWith(prefix) && x.length > prefix.length);
  return l === undefined ? undefined : str(l.slice(prefix.length), MAX_LABEL);
}

function classify(o: Obj, labels: string[]): IndicatorClassification {
  for (const c of ["malicious", "surveillance", "contextual"] as const) {
    if (labels.includes(`adtripwire:${c}`)) return c;
  }
  const types = Array.isArray(o["indicator_types"]) ? (o["indicator_types"] as unknown[]) : [];
  if (types.includes("malicious-activity") || types.includes("compromised")) return "malicious";
  return "contextual";
}

/** STIX 0-100 confidence → AdTripwire level. Missing → low (conservative). */
function confidenceOf(v: unknown): Confidence {
  if (typeof v !== "number" || !Number.isFinite(v)) return "low";
  if (v >= 70) return "high";
  if (v >= 45) return "medium";
  return "low";
}

function firstRef(o: Obj): Obj | undefined {
  const refs = o["external_references"];
  return Array.isArray(refs) && isObj(refs[0]) ? refs[0] : undefined;
}

function httpUrl(v: unknown): string | undefined {
  const s = str(v, 2_000);
  return s !== undefined && /^https?:\/\/[^\s]+$/i.test(s) ? s : undefined;
}

/** Converts a parsed (or raw JSON text) STIX 2.1 bundle into a validated indicator set. */
export function stixToIndicatorSet(bundleJson: unknown, opts: StixImportOptions): StixImportResult {
  let input = bundleJson;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input) as unknown;
    } catch {
      return { ok: false, errors: ["bundle: not valid JSON"] };
    }
  }
  if (!isObj(input) || input["type"] !== "bundle") {
    return { ok: false, errors: ['bundle: expected a STIX object with type "bundle"'] };
  }
  const objects = input["objects"];
  if (!Array.isArray(objects)) return { ok: false, errors: ["bundle.objects: must be an array"] };
  if (objects.length > MAX_OBJECTS) {
    return { ok: false, errors: [`bundle.objects: more than ${MAX_OBJECTS} objects`] };
  }
  const bundleId = str(input["id"], 200) ?? "bundle--unknown";

  const identities = new Map<string, { name: string; created?: string }>();
  for (const o of objects) {
    if (!isObj(o) || o["type"] !== "identity") continue;
    const id = str(o["id"], 200);
    const name = str(o["name"], 200);
    const created = day(o["created"]);
    if (id !== undefined && name !== undefined) {
      identities.set(id, created !== undefined ? { name, created } : { name });
    }
  }

  const warnings: string[] = [];
  const skipped = new Map<string, { count: number; example: string }>();
  const skip = (kind: string, id: string): void => {
    const s = skipped.get(kind);
    if (s) s.count++;
    else skipped.set(kind, { count: 1, example: id });
  };

  type Candidate = { rec: IndicatorRecord; identity?: string };
  const candidates: Candidate[] = [];
  let indicatorCount = 0;
  for (const o of objects) {
    if (!isObj(o) || o["type"] !== "indicator") continue;
    indicatorCount++;
    const id = str(o["id"], 200) ?? `indicator-${indicatorCount}`;
    if (o["revoked"] === true) {
      skip("revoked", id);
      continue;
    }
    if (o["pattern_type"] !== "stix") {
      skip(`pattern_type ${String(str(o["pattern_type"], 40) ?? "missing")}`, id);
      continue;
    }
    const pattern = typeof o["pattern"] === "string" ? o["pattern"] : "";
    const values = parseDomainPattern(pattern);
    if (values === null) {
      skip(`unsupported pattern (${patternKind(o["pattern"])})`, id);
      continue;
    }
    const labels = labelsOf(o);
    const ref = firstRef(o);
    const createdBy = str(o["created_by_ref"], 200);
    const identity = createdBy !== undefined ? identities.get(createdBy) : undefined;
    const firstReported = day(o["valid_from"]) ?? day(o["created"]);
    if (firstReported === undefined) {
      skip("missing valid_from/created timestamp", id);
      continue;
    }
    const modified = day(o["modified"]);
    const lastReviewed =
      modified !== undefined && modified > firstReported ? modified : firstReported;
    const validTo = day(o["valid_until"]);
    const role = labelValue(labels, "role:") ?? labelValue(labels, "tier:");
    const notes = str(o["description"]);
    values.forEach((value, i) => {
      const rec: IndicatorRecord = {
        id: values.length === 1 ? id : `${id}#${i + 1}`,
        indicator: value.toLowerCase(),
        // Tenants of shared platforms (e.g. d0abc.cloudfront.net) are imported as exact hostnames:
        // a `domain` record there would be rejected as too broad by the validator.
        indicatorType:
          labels.includes("adtripwire:type:hostname") ||
          BROAD_DOMAIN_DENYLIST.some((d) => hostnameMatchesDomain(value.toLowerCase(), d))
            ? "hostname"
            : "domain",
        source: identity?.name ?? str(ref?.["source_name"], 200) ?? "STIX import",
        sourceUrl: httpUrl(ref?.["url"]) ?? `urn:stix:${id}`,
        campaign: labelValue(labels, "campaign:") ?? opts.setId,
        classification: classify(o, labels),
        confidence: confidenceOf(o["confidence"]),
        firstReported,
        lastReviewed,
        ...(validTo !== undefined ? { validTo } : {}),
        enabled: true,
        ...(role !== undefined ? { role } : {}),
        ...(notes !== undefined ? { notes } : {}),
      };
      candidates.push(createdBy !== undefined && identity ? { rec, identity: createdBy } : { rec });
    });
  }

  for (const [kind, s] of skipped) {
    warnings.push(`Skipped ${s.count} indicator(s): ${kind} (e.g. ${s.example}).`);
  }

  // Per-record validation so one bad record (e.g. a CDN apex) does not sink the whole import.
  const probeMeta: IndicatorSetMeta = {
    id: opts.setId,
    name: opts.name,
    version: "probe",
    asOf: "2000-01-01",
    license: opts.license,
    synthetic: false,
    sources: [],
  };
  const accepted: Candidate[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const c of candidates) {
    const v = validateIndicatorSet({ meta: probeMeta, indicators: [c.rec] });
    if (!v.ok) {
      rejected.push(`Rejected ${c.rec.indicator}: ${v.errors.join("; ")}`);
      continue;
    }
    const rec = v.set.indicators[0]!;
    const key = `${rec.indicatorType}:${rec.indicator}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    accepted.push(c.identity !== undefined ? { rec, identity: c.identity } : { rec });
  }
  if (duplicates > 0) warnings.push(`Dropped ${duplicates} duplicate indicator value(s).`);

  if (accepted.length === 0) {
    return {
      ok: false,
      errors: [
        `No importable domain-name indicators found (${indicatorCount} indicator object(s) in bundle).`,
        ...rejected,
        ...warnings,
      ],
    };
  }
  if (rejected.length > MAX_WARNINGS_PER_KIND) {
    warnings.push(...rejected.slice(0, MAX_WARNINGS_PER_KIND));
    warnings.push(`… and ${rejected.length - MAX_WARNINGS_PER_KIND} more rejected record(s).`);
  } else {
    warnings.push(...rejected);
  }

  const asOf = accepted.reduce(
    (m, c) => (c.rec.lastReviewed > m ? c.rec.lastReviewed : m),
    "0000-00-00",
  );
  const sources: IndicatorSetMeta["sources"] = [];
  for (const idt of [...new Set(accepted.map((c) => c.identity).filter((x) => x !== undefined))]) {
    const info = identities.get(idt)!;
    sources.push({ name: info.name, url: `urn:stix:${idt}`, published: info.created ?? asOf });
  }
  if (sources.length === 0) {
    sources.push({ name: "STIX 2.1 bundle", url: `urn:stix:${bundleId}`, published: asOf });
  }

  const set = {
    meta: {
      id: opts.setId,
      name: opts.name,
      version: asOf,
      asOf,
      license: opts.license,
      synthetic: false,
      sources,
      description: `Imported from STIX 2.1 bundle ${bundleId}: ${accepted.length} domain-name indicator(s) out of ${indicatorCount} indicator object(s). Imported names match the name and its subdomains unless labelled adtripwire:type:hostname.`,
    },
    indicators: accepted.map((c) => c.rec),
  };
  const final = validateIndicatorSet(set);
  if (!final.ok) return { ok: false, errors: final.errors };
  return { ok: true, set: final.set, warnings };
}
