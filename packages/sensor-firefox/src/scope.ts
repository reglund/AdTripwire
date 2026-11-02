import type { IndicatorRecord, IndicatorSet } from "@adtripwire/shared";

/** NOAS/getAd path segments documented by Citizen Lab (Appendix C). Case-sensitive. */
export const NOAS_PATH_PATTERNS = ["/getAd", "/cplatform/getAd"] as const;

export function isNoasPath(pathPattern: string): boolean {
  for (const p of NOAS_PATH_PATTERNS) {
    if (pathPattern === p || pathPattern.startsWith(p + "/")) return true;
  }
  return false;
}

/**
 * Builds the webRequest match patterns for the blocking (filter-attaching) listener so
 * that response inspection is attempted ONLY for indicator hosts and NOAS-pattern paths.
 * Ordinary browsing never enters the blocking path.
 */
export function buildInspectionMatchPatterns(sets: IndicatorSet[]): string[] {
  const patterns = new Set<string>();
  for (const p of NOAS_PATH_PATTERNS) {
    patterns.add(`*://*${p}`);
    patterns.add(`*://*${p}/*`);
    patterns.add(`*://*${p}?*`);
  }
  for (const set of sets) {
    if (set.meta.synthetic) continue; // synthetic sets are only wired in explicitly by tests/dev builds
    for (const r of set.indicators) addIndicatorPatterns(patterns, r);
  }
  return Array.from(patterns);
}

export function addIndicatorPatterns(patterns: Set<string>, r: IndicatorRecord): void {
  if (!r.enabled) return;
  if (r.indicatorType === "domain") {
    patterns.add(`*://${r.indicator}/*`);
    patterns.add(`*://*.${r.indicator}/*`);
  } else if (r.indicatorType === "hostname" || r.indicatorType === "hostname_path") {
    patterns.add(`*://${r.indicator}/*`);
  }
  // url_path indicators are matched by the path-pattern logic, not by host patterns.
}

/** Resource types eligible for response inspection. Scripts are where selective JS lands. */
export const INSPECTABLE_TYPES = new Set(["script", "xmlhttprequest", "sub_frame", "other"]);

export function isInspectableContentType(ct: string | undefined): boolean {
  if (!ct) return true; // unknown: allow; the decoder will reject binary
  const mt = ct.split(";")[0]!.trim().toLowerCase();
  return (
    mt === "" ||
    mt.startsWith("text/") ||
    mt.includes("javascript") ||
    mt.includes("ecmascript") ||
    mt === "application/json" ||
    mt === "application/octet-stream"
  );
}

export function mediaTypeOf(ct: string | undefined): string | undefined {
  if (!ct) return undefined;
  const mt = ct.split(";")[0]!.trim().toLowerCase();
  return mt === "" ? undefined : mt;
}
