import type { IndicatorSet } from "@adtripwire/shared";
import adfection from "../data/adfection-2026.json";
import { IndicatorMatcher } from "./matcher.js";
import { validateIndicatorSet } from "./validate.js";

function loadValidated(name: string, raw: unknown): IndicatorSet {
  const result = validateIndicatorSet(raw);
  if (!result.ok) {
    throw new Error(`Bundled indicator set "${name}" is invalid:\n${result.errors.join("\n")}`);
  }
  return result.set;
}

/** Curated, validated indicator sets shipped with the extension. Throws at load time if invalid. */
export const BUNDLED_INDICATOR_SETS: IndicatorSet[] = [loadValidated("adfection-2026", adfection)];

export function loadBundledMatcher(): IndicatorMatcher {
  return new IndicatorMatcher(BUNDLED_INDICATOR_SETS);
}
