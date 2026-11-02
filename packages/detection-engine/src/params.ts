/** Single seam for query-parameter classification from @adtripwire/privacy. */
import {
  IDENTIFIER_PARAM_NAMES,
  classifyParamNames,
  identifierParamCategory,
} from "@adtripwire/privacy";

/** Query macros documented on NOAS/getAd script URLs (lower-cased, as SanitizedUrl stores names). */
export const NOAS_QUERY_MACROS: ReadonlySet<string> = new Set([
  "idfa",
  "sourceid",
  "dom",
  "page",
  "country",
  "ipv4",
  "os",
  "devicemodel",
  "dsp",
  "infififo",
  "user_id",
]);

export function hasIdentifierLikeParam(names: readonly string[]): boolean {
  return names.some((n) => NOAS_QUERY_MACROS.has(n) || IDENTIFIER_PARAM_NAMES.has(n));
}

/** Identifier-category parameter names (ad-tech bookkeeping names such as q/qq/impid are excluded). */
export function identifierParams(names: readonly string[]): {
  count: number;
  categories: string[];
  hasCookieMaterial: boolean;
  hasContact: boolean;
} {
  const c = classifyParamNames([...names]);
  let count = 0;
  for (const n of names) {
    const cat = identifierParamCategory(n);
    if (cat !== null && cat !== "ad_tech") count++;
  }
  return {
    count,
    categories: c.categories.filter((x) => x !== "ad_tech"),
    hasCookieMaterial: c.hasCookieMaterial,
    hasContact: c.hasContact,
  };
}
