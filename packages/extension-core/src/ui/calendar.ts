/**
 * Pure helpers for the Exposure calendar: 53 ISO weeks (Monday first) ending in the week of
 * "today", one cell per local calendar day. No DOM, so it is unit-tested in Node.
 *
 * `localDate`/`shiftDate` are small copies of the helpers in `background/daily.ts`: the UI
 * bundles do not import from the background tree. Both are calendar arithmetic on a
 * YYYY-MM-DD key (not 24 h steps), so a DST change cannot skip or repeat a day.
 */
import type { DayStats, Digest } from "@adtripwire/shared";
import { currentLanguage, t } from "./i18n.js";

export const CALENDAR_WEEKS = 53;

export type CellState = "future" | "empty" | "seen" | "contact" | "strong";

export interface CalendarCell {
  /** Local date, YYYY-MM-DD. */
  date: string;
  state: CellState;
  pages: number;
  contacts: number;
  hosts: string[];
  strong: number;
}

const pad = (n: number): string => String(n).padStart(2, "0");

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

/** Local Date at midnight for a YYYY-MM-DD key. */
export function dateOf(date: string): Date {
  const [y, m, d] = parts(date);
  return new Date(y, m - 1, d);
}

export function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = parts(date);
  return localDate(new Date(y, m - 1, d + deltaDays));
}

/** 0 = Monday ... 6 = Sunday. */
const isoWeekday = (date: string): number => (dateOf(date).getDay() + 6) % 7;

const locale = (): string => (currentLanguage() === "nb" ? "nb-NO" : "en");

/** Long, localised date for prose and aria-labels. */
export function formatDay(date: string): string {
  return dateOf(date).toLocaleDateString(locale(), { dateStyle: "long" });
}

/**
 * 371 cells in column-major order (week by week, Monday first), the last column being the
 * week that contains `today`. Cells after `today` are `future`.
 */
export function calendarCells(days: readonly DayStats[], today: string): CalendarCell[] {
  const byDate = new Map<string, DayStats>();
  for (const d of days) byDate.set(d.date, d);
  const start = shiftDate(today, -isoWeekday(today) - (CALENDAR_WEEKS - 1) * 7);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < CALENDAR_WEEKS * 7; i++) {
    const date = shiftDate(start, i);
    const day = date > today ? undefined : byDate.get(date);
    const pages = day?.pages ?? 0;
    const contacts = day?.contacts ?? 0;
    const strong = day?.strong ?? 0;
    const state: CellState =
      date > today
        ? "future"
        : strong > 0
          ? "strong"
          : contacts > 0
            ? "contact"
            : pages > 0
              ? "seen"
              : "empty";
    cells.push({ date, state, pages, contacts, hosts: day ? [...day.hosts] : [], strong });
  }
  return cells;
}

/** Month names above the grid: the first week column of each month (0-based column index). */
export function monthLabels(
  cells: readonly CalendarCell[],
): Array<{ column: number; label: string }> {
  const out: Array<{ column: number; label: string }> = [];
  let prev = -1;
  for (let col = 0; col * 7 < cells.length; col++) {
    const first = cells[col * 7];
    if (!first) break;
    const month = dateOf(first.date).getMonth();
    if (month !== prev) {
      out.push({
        column: col,
        label: dateOf(first.date).toLocaleDateString(locale(), { month: "short" }),
      });
      prev = month;
    }
  }
  // The leftmost label would collide with the next one when the month changes in column 1.
  if (out.length > 1 && out[1]?.column === 1) out.shift();
  return out;
}

/** The plain sentence used for the cell's aria-label and the status line. */
export function dayLabelText(cell: CalendarCell): string {
  const date = formatDay(cell.date);
  switch (cell.state) {
    case "future":
      return date;
    case "empty":
      return t("{date}: nothing recorded.", { date });
    case "seen":
      return t(
        "{date}: {pages} page(s) counted; no contact with documented infrastructure recorded.",
        {
          date,
          pages: cell.pages,
        },
      );
    case "contact":
    case "strong": {
      const base = t(
        "{date}: {pages} page(s) counted; {contacts} contact(s) with documented infrastructure: {hosts}.",
        {
          date,
          pages: cell.pages,
          contacts: cell.contacts,
          hosts: cell.hosts.join(", ") || t("none recorded"),
        },
      );
      return cell.strong > 0
        ? `${base} ${t("{n} detection(s) at elevated priority.", { n: cell.strong })}`
        : base;
    }
  }
}

/** Short weekday name for a grid row (0 = Monday). */
export function weekdayName(row: number): string {
  // 2024-01-01 was a Monday.
  return new Date(2024, 0, 1 + row).toLocaleDateString(locale(), { weekday: "short" });
}

/** Yesterday's entry in the digest, or null when nothing was recorded for it. */
export function yesterdayOf(digest: Digest): DayStats | null {
  const date = shiftDate(digest.today, -1);
  return digest.days.find((d) => d.date === date) ?? null;
}

/** First three hosts, then "+n". */
export function hostsText(hosts: readonly string[], max = 3): string {
  const shown = hosts.slice(0, max).join(", ");
  return hosts.length > max ? `${shown} +${hosts.length - max}` : shown;
}

/**
 * The morning line: what yesterday looked like, plus the last contact when there is one.
 * Null when the digest has no entry for yesterday.
 */
export function morningLine(digest: Digest): string | null {
  const y = yesterdayOf(digest);
  if (!y) return null;
  let line = t(
    "Yesterday: {pages} page(s), {contacts} contact(s) with documented infrastructure.",
    { pages: y.pages, contacts: y.contacts },
  );
  if (digest.lastContact) {
    line += ` ${t("Last contact {date}: {hosts}.", {
      date: formatDay(digest.lastContact.date),
      hosts: hostsText(digest.lastContact.hosts) || t("none recorded"),
    })}`;
  }
  return line;
}
