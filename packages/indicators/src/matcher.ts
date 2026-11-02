import type {
  Confidence,
  IndicatorClassification,
  IndicatorMatch,
  IndicatorRecord,
  IndicatorSet,
  IndicatorSetMeta,
} from "@adtripwire/shared";
import { isIpAddress, normalizeHostname, parentDomains } from "./hostname.js";
import { validateIndicatorSet } from "./validate.js";

const CLASS_RANK: Record<IndicatorClassification, number> = {
  malicious: 0,
  surveillance: 1,
  contextual: 2,
};
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Case-sensitive prefix match at a path boundary: "/getAd" matches "/getAd", "/getAd/x", not "/getAdvanced". */
function pathMatches(path: string, prefix: string): boolean {
  if (!path.startsWith(prefix)) return false;
  if (path.length === prefix.length || prefix.endsWith("/")) return true;
  const next = path.charAt(prefix.length);
  return next === "/" || next === "?" || next === "#";
}

function compareMatches(a: IndicatorMatch, b: IndicatorMatch): number {
  const c = CLASS_RANK[a.indicator.classification] - CLASS_RANK[b.indicator.classification];
  if (c !== 0) return c;
  const f = CONFIDENCE_RANK[a.indicator.confidence] - CONFIDENCE_RANK[b.indicator.confidence];
  if (f !== 0) return f;
  return a.indicator.id < b.indicator.id ? -1 : a.indicator.id > b.indicator.id ? 1 : 0;
}

/** Strongest classification among matches (malicious > surveillance > contextual), or null. */
export function strongestClassification(matches: IndicatorMatch[]): IndicatorClassification | null {
  let best: IndicatorClassification | null = null;
  for (const m of matches) {
    const c = m.indicator.classification;
    if (best === null || CLASS_RANK[c] < CLASS_RANK[best]) best = c;
  }
  return best;
}

export class IndicatorMatcher {
  readonly #metas: IndicatorSetMeta[] = [];
  readonly #exact = new Map<string, IndicatorRecord[]>();
  readonly #domains = new Map<string, IndicatorRecord[]>();
  readonly #hostPaths = new Map<string, IndicatorRecord[]>();
  readonly #urlPaths: IndicatorRecord[] = [];
  readonly #idToSet = new Map<string, string>();
  #size = 0;

  /** Sets are assumed validated (see `validateIndicatorSet` / `fromJson`). Disabled records are ignored. */
  constructor(sets: IndicatorSet[]) {
    for (const set of sets) {
      this.#metas.push(set.meta);
      for (const rec of set.indicators) {
        if (!rec.enabled || this.#idToSet.has(rec.id)) continue;
        this.#idToSet.set(rec.id, set.meta.id);
        this.#size++;
        switch (rec.indicatorType) {
          case "hostname":
            push(this.#exact, rec.indicator, rec);
            break;
          case "domain":
            push(this.#domains, rec.indicator, rec);
            break;
          case "hostname_path":
            push(this.#hostPaths, rec.indicator, rec);
            break;
          case "url_path":
            this.#urlPaths.push(rec);
            break;
        }
      }
    }
  }

  get sets(): IndicatorSetMeta[] {
    return [...this.#metas];
  }

  /** Number of enabled indicators. */
  get size(): number {
    return this.#size;
  }

  /** True if an enabled indicator with this id is loaded. */
  has(indicatorId: string): boolean {
    return this.#idToSet.has(indicatorId);
  }

  /**
   * @param now evaluation time (ms since epoch) used for validity windows; defaults to Date.now().
   */
  match(hostname: string, pathPattern?: string, now: number = Date.now()): IndicatorMatch[] {
    const host = normalizeHostname(hostname);
    if (host === null) return [];
    const found = new Map<string, IndicatorMatch>();
    const add = (rec: IndicatorRecord, matchKind: IndicatorMatch["matchKind"]): void => {
      if (found.has(rec.id)) return;
      found.set(rec.id, {
        indicator: rec,
        setId: this.#idToSet.get(rec.id) ?? "",
        matchKind,
        validity: indicatorValidity(rec, now),
      });
    };

    for (const rec of this.#exact.get(host) ?? []) add(rec, "exact_hostname");

    if (!isIpAddress(host)) {
      for (const parent of parentDomains(host)) {
        for (const rec of this.#domains.get(parent) ?? []) add(rec, "domain_suffix");
      }
    }

    if (pathPattern !== undefined && pathPattern.startsWith("/")) {
      for (const rec of this.#hostPaths.get(host) ?? []) {
        if (rec.pathPattern !== undefined && pathMatches(pathPattern, rec.pathPattern)) {
          add(rec, "hostname_path");
        }
      }
      for (const rec of this.#urlPaths) {
        if (rec.pathPattern !== undefined && pathMatches(pathPattern, rec.pathPattern)) {
          add(rec, "url_path");
        }
      }
    }

    return [...found.values()].sort(compareMatches);
  }

  /** Validate each JSON value as an indicator set; invalid sets are skipped and reported in `errors`. */
  static fromJson(jsonValues: unknown[]): { matcher: IndicatorMatcher; errors: string[] } {
    const sets: IndicatorSet[] = [];
    const errors: string[] = [];
    const seenSetIds = new Set<string>();
    jsonValues.forEach((value, i) => {
      const result = validateIndicatorSet(value);
      if (!result.ok) {
        for (const e of result.errors) errors.push(`set[${i}]: ${e}`);
        return;
      }
      if (seenSetIds.has(result.set.meta.id)) {
        errors.push(`set[${i}]: duplicate set id "${result.set.meta.id}"`);
        return;
      }
      seenSetIds.add(result.set.meta.id);
      sets.push(result.set);
    });
    return { matcher: new IndicatorMatcher(sets), errors };
  }
}

/** Validity of an indicator at `now`, from its optional validFrom/validTo (ISO dates, inclusive). */
export function indicatorValidity(rec: IndicatorRecord, now: number): IndicatorMatch["validity"] {
  if (rec.validFrom !== undefined) {
    const from = Date.parse(rec.validFrom + "T00:00:00Z");
    if (Number.isFinite(from) && now < from) return "not_yet_valid";
  }
  if (rec.validTo !== undefined) {
    // Inclusive end date: expired from the first instant of the following day.
    const to = Date.parse(rec.validTo + "T00:00:00Z") + 86_400_000;
    if (Number.isFinite(to) && now >= to) return "expired";
  }
  return "current";
}
