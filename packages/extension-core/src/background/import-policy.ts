import type { IndicatorRecord, IndicatorSet } from "@adtripwire/shared";
import { hostnameMatchesDomain } from "@adtripwire/indicators";

/** Maximum indicators across all imported sets (keeps match-pattern counts bounded). */
export const MAX_IMPORTED_INDICATORS_TOTAL = 5000;

export interface PrecedenceResult {
  kept: IndicatorRecord[];
  dropped: Array<{ record: IndicatorRecord; reason: string }>;
}

/**
 * Bundled curation takes precedence over imports. An imported record is dropped when it
 * - is a host-independent `url_path` (never accepted from imports),
 * - names the same host as a bundled record,
 * - is a `domain` that covers any bundled host (parent of a bundled indicator), or
 * - is a host covered by a bundled `domain` (child of a bundled indicator).
 * This keeps a broader upstream feed from re-ranking hosts the bundled set already classifies.
 */
export function applyBundledPrecedence(
  imported: IndicatorSet,
  bundledSets: readonly IndicatorSet[],
): PrecedenceResult {
  const bundled = bundledSets
    .filter((s) => !s.meta.synthetic)
    .flatMap((s) => s.indicators.filter((r) => r.enabled));
  const bundledHosts = new Set(bundled.map((r) => r.indicator));
  const bundledDomains = bundled
    .filter((r) => r.indicatorType === "domain")
    .map((r) => r.indicator);
  const kept: IndicatorRecord[] = [];
  const dropped: PrecedenceResult["dropped"] = [];
  for (const rec of imported.indicators) {
    if (rec.indicatorType === "url_path") {
      dropped.push({
        record: rec,
        reason: "host-independent url_path indicators are not accepted from imports",
      });
      continue;
    }
    const host = rec.indicator;
    if (bundledHosts.has(host)) {
      dropped.push({ record: rec, reason: `already covered by the bundled set (${host})` });
      continue;
    }
    if (
      rec.indicatorType === "domain" &&
      bundled.some((b) => hostnameMatchesDomain(b.indicator, host))
    ) {
      dropped.push({
        record: rec,
        reason: `domain ${host} would cover hosts the bundled set classifies separately`,
      });
      continue;
    }
    if (bundledDomains.some((d) => hostnameMatchesDomain(host, d))) {
      dropped.push({ record: rec, reason: `${host} is covered by a bundled domain indicator` });
      continue;
    }
    kept.push(rec);
  }
  return { kept, dropped };
}

/** Summarises drop reasons into a few warning strings. */
export function summariseDrops(dropped: PrecedenceResult["dropped"]): string[] {
  const byReason = new Map<string, number>();
  for (const d of dropped) {
    const key = d.reason.replace(/\(.*?\)|[a-z0-9.-]+\.[a-z]{2,}/g, "…");
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }
  return Array.from(byReason, ([reason, n]) => `${n} indicator(s) skipped: ${reason}`);
}
