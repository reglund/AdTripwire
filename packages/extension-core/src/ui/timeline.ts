/** Pure helpers for the Timeline view (filters and visual grouping). */
import type { TimelineEntry } from "@adtripwire/shared";
import { t } from "./i18n.js";

export type SinceKey = "1h" | "24h" | "7d" | "all";

export const SINCE_OPTIONS: ReadonlyArray<{ key: SinceKey; label: string }> = [
  { key: "1h", label: "Last hour" },
  { key: "24h", label: "Last 24 hours" },
  { key: "7d", label: "Last 7 days" },
  { key: "all", label: "All stored" },
];

export const DEFAULT_SINCE: SinceKey = "24h";
export const TIMELINE_LIMIT = 500;

const WINDOW_MS: Record<Exclude<SinceKey, "all">, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
};

/** Converts a "since" selection to an epoch-ms lower bound; `undefined` means no lower bound. */
export function sinceTimestamp(key: string, now: number = Date.now()): number | undefined {
  if (key === "1h" || key === "24h" || key === "7d") return now - WINDOW_MS[key];
  return undefined;
}

export type TabIdParse = { ok: true; tabId: number | undefined } | { ok: false; error: string };

/** Parses the tab-id filter input. Empty means "all tabs". */
export function parseTabId(raw: string): TabIdParse {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, tabId: undefined };
  if (!/^\d{1,9}$/.test(trimmed)) {
    return { ok: false, error: "Enter a whole number (the tab id), or leave empty for all tabs." };
  }
  return { ok: true, tabId: Number(trimmed) };
}

/** Oldest first; ties keep the original order. */
export function sortTimeline(entries: readonly TimelineEntry[]): TimelineEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.timestamp - b.entry.timestamp || a.index - b.index)
    .map((x) => x.entry);
}

export interface TimelineGroup {
  tabId: number | undefined;
  entries: TimelineEntry[];
}

/** Splits into runs of consecutive entries that share a tab id. Input order is preserved. */
export function groupByTab(entries: readonly TimelineEntry[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.tabId === entry.tabId) last.entries.push(entry);
    else groups.push({ tabId: entry.tabId, entries: [entry] });
  }
  return groups;
}

export function tabLabel(tabId: number | undefined): string {
  return tabId === undefined ? t("No tab") : t("Tab {id}", { id: tabId });
}
