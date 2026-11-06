import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALWAYS_CANNOT_SEE,
  CAPABILITY_LABELS,
  CATEGORY_LABELS,
  CONFIDENCE_LABELS,
  NO_DETECTIONS_NOTICE,
  PAGE_SIGNAL_LABELS,
  PILL_TEXT,
  SENSOR_LABELS,
  SEVERITY_LABELS,
  relativeTime,
  severityLabel,
  summarizeVisibility,
} from "./format.js";
import { SINCE_OPTIONS } from "./filter.js";
import { SINCE_OPTIONS as TIMELINE_SINCE_OPTIONS } from "./timeline.js";
import { resolveLanguage, setLanguage, t } from "./i18n.js";
import { NB } from "./i18n.nb.js";
import { TABS } from "./route.js";

const FORBIDDEN = /\binfisert\b|\bspionert\b|\ber trygg\b/i;
const uiDir = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.startsWith("i18n")) {
      out.push(full);
    }
  }
  return out;
}

/** String literals passed directly to t("..."), including calls split over several lines. */
function extractKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const re = /(?<![\w.])t\(\s*"((?:[^"\\]|\\.)*)"/g;
  for (const file of sourceFiles(uiDir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) {
      keys.set(JSON.parse(`"${m[1] ?? ""}"`) as string, file);
    }
  }
  return keys;
}

const placeholders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();

afterEach(() => setLanguage("en"));

describe("t", () => {
  it("returns the English text when no translation exists or the language is English", () => {
    setLanguage("nb");
    expect(t("A string that has no translation")).toBe("A string that has no translation");
    setLanguage("en");
    expect(t("Overview")).toBe("Overview");
  });

  it("translates when the language is nb", () => {
    setLanguage("nb");
    expect(t("Overview")).toBe("Oversikt");
  });

  it("substitutes placeholders in both languages, including repeated ones", () => {
    expect(t("Saved at {time}.", { time: "12:00" })).toBe("Saved at 12:00.");
    expect(t("{a}-{a}-{b}", { a: "x", b: 2 })).toBe("x-x-2");
    setLanguage("nb");
    expect(t("Saved at {time}.", { time: "12:00" })).toBe("Lagret 12:00.");
  });
});

describe("resolveLanguage", () => {
  it("maps Norwegian locales to nb and everything else to en", () => {
    for (const l of ["nb-NO", "nb", "nn", "nn-NO", "no", "no-NO"]) {
      expect(resolveLanguage("auto", l)).toBe("nb");
    }
    for (const l of ["en-US", "de", "sv", "", undefined]) {
      expect(resolveLanguage("auto", l)).toBe("en");
    }
  });

  it("lets an explicit setting win over the browser language", () => {
    expect(resolveLanguage("en", "nb-NO")).toBe("en");
    expect(resolveLanguage("nb", "en-US")).toBe("nb");
  });
});

describe("format helpers follow the active language", () => {
  it("translates labels and relative times only at use time", () => {
    expect(severityLabel("suspicious")).toBe("Suspicious");
    expect(relativeTime(0, 3 * 60_000)).toBe("3 minutes ago");
    setLanguage("nb");
    expect(severityLabel("suspicious")).toBe("Mistenkelig");
    expect(relativeTime(0, 3 * 60_000)).toBe("3 minutter siden");
    expect(SEVERITY_LABELS.suspicious).toBe("Suspicious");
  });
});

describe("NB dictionary", () => {
  it("has only non-empty values without verdict wording", () => {
    for (const [key, value] of Object.entries(NB)) {
      expect(value.trim().length, key).toBeGreaterThan(0);
      expect(FORBIDDEN.test(value), `${key} -> ${value}`).toBe(false);
    }
  });

  it("keeps the placeholders of every key", () => {
    for (const [key, value] of Object.entries(NB)) {
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
  });

  it("covers every string literal passed to t() in the UI sources", () => {
    const missing = [...extractKeys()].filter(([key]) => !(key in NB));
    expect(missing.map(([key, file]) => `${key} (${file})`)).toEqual([]);
  });

  it("covers the label tables that are translated at use time", () => {
    const tables: string[] = [
      ...Object.values(SEVERITY_LABELS),
      ...Object.values(CONFIDENCE_LABELS),
      ...Object.values(CATEGORY_LABELS),
      ...Object.values(CAPABILITY_LABELS),
      ...Object.values(PAGE_SIGNAL_LABELS),
      ...Object.values(SENSOR_LABELS),
      ...Object.values(PILL_TEXT),
      ...ALWAYS_CANNOT_SEE,
      NO_DETECTIONS_NOTICE,
      ...TABS.map((tab) => tab.label),
      ...SINCE_OPTIONS.map((o) => o.label),
      ...TIMELINE_SINCE_OPTIONS.map((o) => o.label),
    ];
    const allCaps = Object.keys(CAPABILITY_LABELS) as Array<keyof typeof CAPABILITY_LABELS>;
    const vis = summarizeVisibility({ capabilities: [] });
    expect(vis.cannotSee.length).toBe(allCaps.length + ALWAYS_CANNOT_SEE.length);
    expect(tables.filter((s) => !(s in NB))).toEqual([]);
    setLanguage("nb");
    const nbVis = summarizeVisibility({ capabilities: [] });
    expect(nbVis.cannotSee.filter((s) => !Object.values(NB).includes(s))).toEqual([]);
  });
});

describe("observatory strings", () => {
  it("carry no verdict wording (safe, clean, infected, spied)", () => {
    const text = readFileSync(join(uiDir, "views", "exposure.ts"), "utf8");
    const keys = [...extractKeys().entries()]
      .filter(([, file]) => file.endsWith("exposure.ts"))
      .map(([k]) => k)
      .filter((k) => /observatory/i.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(text).toContain("observatoryLookup");
    for (const key of keys) {
      expect(key).not.toMatch(/\b(safe|clean|infected|spied)\b/i);
      expect(NB[key]).not.toMatch(FORBIDDEN);
    }
  });
});
