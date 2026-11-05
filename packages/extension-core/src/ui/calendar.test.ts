import type { DayStats, Digest } from "@adtripwire/shared";
import { afterEach, describe, expect, it } from "vitest";
import { calendarCells, dayLabelText, monthLabels, morningLine, shiftDate } from "./calendar.js";
import { setLanguage } from "./i18n.js";

const day = (date: string, patch: Partial<DayStats> = {}): DayStats => ({
  date,
  pages: 0,
  pagesMeasured: 0,
  thirdPartyDomainsTotal: 0,
  thirdPartyDomainsMax: 0,
  contacts: 0,
  hosts: [],
  strong: 0,
  ...patch,
});

// 2026-11-05 is a Thursday.
const TODAY = "2026-11-05";

afterEach(() => setLanguage("en"));

describe("calendarCells", () => {
  it("returns 53 weeks of 7 cells, Monday first, ending in today's week", () => {
    const cells = calendarCells([], TODAY);
    expect(cells).toHaveLength(371);
    expect(new Date(cells[0]!.date + "T12:00:00").getDay()).toBe(1);
    expect(cells[0]!.date).toBe(shiftDate("2026-11-02", -52 * 7));
    // Last column: Mon 2 Nov ... Sun 8 Nov.
    expect(cells.slice(-7).map((c) => c.date)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
  });

  it("makes today the last non-future cell and marks later days future", () => {
    const cells = calendarCells([], TODAY);
    const nonFuture = cells.filter((c) => c.state !== "future");
    expect(nonFuture.at(-1)?.date).toBe(TODAY);
    expect(cells.filter((c) => c.state === "future").map((c) => c.date)).toEqual([
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
  });

  it("keeps a full week when today is a Sunday", () => {
    const cells = calendarCells([], "2026-11-08");
    expect(cells).toHaveLength(371);
    expect(cells.at(-1)?.date).toBe("2026-11-08");
    expect(cells.some((c) => c.state === "future")).toBe(false);
  });

  it("derives the state from pages, contacts and strong detections", () => {
    const cells = calendarCells(
      [
        day("2026-11-01", { pages: 4 }),
        day("2026-11-02", { pages: 3, contacts: 1, hosts: ["a.test"] }),
        day("2026-11-03", { pages: 3, contacts: 2, hosts: ["b.test"], strong: 1 }),
        day("2026-11-04"),
        day("2026-11-07", { pages: 9 }),
      ],
      TODAY,
    );
    const state = (d: string) => cells.find((c) => c.date === d)?.state;
    expect(state("2026-10-31")).toBe("empty");
    expect(state("2026-11-01")).toBe("seen");
    expect(state("2026-11-02")).toBe("contact");
    expect(state("2026-11-03")).toBe("strong");
    expect(state("2026-11-04")).toBe("empty");
    expect(state("2026-11-07")).toBe("future");
  });

  it("does not skip or repeat a day across a DST change", () => {
    const dates = calendarCells([], "2026-04-05").map((c) => c.date);
    expect(new Set(dates).size).toBe(371);
  });
});

describe("dayLabelText", () => {
  it("names the documented hosts of a day with contacts", () => {
    const cell = calendarCells(
      [day("2026-11-02", { pages: 3, contacts: 2, hosts: ["a.test", "b.test"] })],
      TODAY,
    ).find((c) => c.date === "2026-11-02")!;
    const text = dayLabelText(cell);
    expect(text).toContain("November 2, 2026");
    expect(text).toContain("3 page(s)");
    expect(text).toContain("2 contact(s)");
    expect(text).toContain("a.test, b.test");
  });

  it("mentions elevated detections only on strong days and stays conservative", () => {
    const cells = calendarCells(
      [
        day("2026-11-03", { pages: 1, contacts: 1, hosts: ["a.test"], strong: 2 }),
        day("2026-11-01", { pages: 2 }),
      ],
      TODAY,
    );
    const strong = dayLabelText(cells.find((c) => c.date === "2026-11-03")!);
    expect(strong).toContain("2 detection(s) at elevated priority");
    const seen = dayLabelText(cells.find((c) => c.date === "2026-11-01")!);
    expect(seen).toContain("no contact with documented infrastructure recorded");
    expect(seen).not.toMatch(/safe|clean|infected|spied/i);
  });

  it("uses the active language for the date and the sentence", () => {
    setLanguage("nb");
    const cell = calendarCells([day("2026-11-01", { pages: 2 })], TODAY).find(
      (c) => c.date === "2026-11-01",
    )!;
    expect(dayLabelText(cell)).toContain("november");
    expect(dayLabelText(cell)).not.toContain("counted");
  });
});

describe("monthLabels", () => {
  it("labels the first week column of each month in order", () => {
    const cells = calendarCells([], TODAY);
    const labels = monthLabels(cells);
    // Columns are strictly increasing and every label sits on a column whose Monday starts a new month.
    expect(labels.length).toBeGreaterThanOrEqual(12);
    expect(labels.length).toBeLessThanOrEqual(14);
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i]!.column).toBeGreaterThan(labels[i - 1]!.column);
      const col = labels[i]!.column;
      const prevMonday = cells[(col - 1) * 7]!.date.slice(5, 7);
      expect(cells[col * 7]!.date.slice(5, 7)).not.toBe(prevMonday);
    }
    // 2 Nov 2026 is the Monday of the last column (52), and November starts there.
    expect(labels.at(-1)).toEqual({ column: 52, label: "Nov" });
    expect(labels[0]!.column).toBeLessThanOrEqual(1 + 4);
  });

  it("drops the leftmost label when the next month starts in column 1", () => {
    // First column Monday 2025-09-29 would be a Sep label, Oct starts in column 1.
    const cells = calendarCells([], shiftDate("2025-09-29", 52 * 7));
    const labels = monthLabels(cells);
    expect(labels[0]?.column).toBe(1);
  });
});

describe("morningLine", () => {
  const digest = (days: DayStats[], lastContact: Digest["lastContact"]): Digest => ({
    today: TODAY,
    days,
    normalThirdPartyPerPage: null,
    lastContact,
  });

  it("is null without an entry for yesterday", () => {
    expect(morningLine(digest([day("2026-11-03", { pages: 2 })], null))).toBeNull();
  });

  it("states yesterday's counts and the last contact with at most three hosts", () => {
    const line = morningLine(
      digest([day("2026-11-04", { pages: 12, contacts: 1 })], {
        date: "2026-11-02",
        hosts: ["a.test", "b.test", "c.test", "d.test", "e.test"],
      }),
    );
    expect(line).toBe(
      "Yesterday: 12 page(s), 1 contact(s) with documented infrastructure. Last contact November 2, 2026: a.test, b.test, c.test +2.",
    );
  });

  it("omits the last-contact sentence when there is none", () => {
    expect(morningLine(digest([day("2026-11-04", { pages: 3 })], null))).toBe(
      "Yesterday: 3 page(s), 0 contact(s) with documented infrastructure.",
    );
  });
});
