/**
 * Minimal UI localisation. English source strings are the keys; `t()` returns the active
 * language's translation or the English text when none exists, so a missing entry degrades
 * to English instead of breaking the page. Rule content (summaries, significance, actions) is
 * data from the detection engine: its Norwegian twin is chosen by detection-text.ts; evidence
 * sentences have no twin and stay English.
 */
import type { Settings } from "@adtripwire/shared";
import { NB } from "./i18n.nb.js";

export type UiLanguage = "en" | "nb";

let active: UiLanguage = "en";

/** Resolves the setting ("auto" follows the browser UI language) to a concrete language. */
export function resolveLanguage(
  setting: Settings["ui"]["language"],
  browserLang?: string,
): UiLanguage {
  if (setting === "en" || setting === "nb") return setting;
  const bl = (browserLang ?? "").toLowerCase();
  return bl.startsWith("nb") || bl.startsWith("nn") || bl.startsWith("no") ? "nb" : "en";
}

export function setLanguage(lang: UiLanguage): void {
  active = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export function currentLanguage(): UiLanguage {
  return active;
}

/** Translates an English UI string. Placeholders `{name}` are substituted after lookup. */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = active === "nb" ? (NB[text] ?? text) : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** Applies the stored setting; call once per page load before rendering. */
export function applyLanguageSetting(settings: Settings): UiLanguage {
  let browserLang: string | undefined;
  try {
    browserLang = browser.i18n.getUILanguage();
  } catch {
    browserLang = undefined;
  }
  const lang = resolveLanguage(settings.ui.language, browserLang);
  setLanguage(lang);
  return lang;
}
