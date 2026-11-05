import { describe, expect, it } from "vitest";
import type { DayStats, Detection, NormalizedEvent } from "@adtripwire/shared";
import {
  MAX_DAY_HOSTS,
  PageAccounting,
  applyNewDetection,
  applyPageFinalised,
  applyPageStarted,
  buildDigest,
  documentedHostFor,
  emptyDay,
  isTopLevelNavigation,
  localDate,
  sanitiseDay,
  shiftDate,
} from "./daily.js";

// Dates are built from local components so the tests hold in any time zone.
const at = (y: number, m: number, d: number, h = 12, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime();

const det = (ruleId: string, severity: Detection["severity"]): Detection =>
  ({ ruleId, severity, subjectHostnames: [], matchedIndicatorIds: [] }) as unknown as Detection;

describe("localDate", () => {
  it("rolls over at local midnight", () => {
    expect(localDate(at(2026, 11, 4, 23, 59))).toBe("2026-11-04");
    expect(localDate(at(2026, 11, 5, 0, 0))).toBe("2026-11-05");
  });
  it("shiftDate uses calendar days across month and year ends", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDate("2026-11-05", -30)).toBe("2026-10-06");
  });
});

describe("PageAccounting", () => {
  it("evicts the oldest tab when the 201st is added", () => {
    const a = new PageAccounting();
    for (let t = 1; t <= 201; t++) a.onNavigation(t, 0, `r${t}`);
    expect(a.size).toBe(200);
    expect(a.onTabRemoved(1)).toBeNull();
    expect(a.onTabRemoved(2)).not.toBeNull();
  });
  it("ignores the 501st distinct domain on a tab", () => {
    const a = new PageAccounting();
    a.onNavigation(1, 0, "r");
    for (let i = 0; i < 501; i++) a.onThirdParty(1, `d${i}.example`);
    a.onThirdParty(1, "d0.example");
    expect(a.onTabRemoved(1)?.count).toBe(500);
  });
  it("finalises the previous page of the same tab only", () => {
    const a = new PageAccounting();
    a.onNavigation(1, 10, "a1");
    a.onNavigation(2, 20, "b1");
    a.onThirdParty(1, "x.example");
    a.onThirdParty(1, "y.example");
    a.onThirdParty(2, "z.example");
    const r = a.onNavigation(1, 30, "a2");
    expect(r).toEqual({ counted: true, finalised: { count: 2, startedAt: 10 } });
    // tab 2 is untouched and the new page of tab 1 starts empty
    expect(a.onTabRemoved(2)).toEqual({ count: 1, startedAt: 20 });
    expect(a.onTabRemoved(1)).toEqual({ count: 0, startedAt: 30 });
  });
  it("finalises on tab removal exactly once", () => {
    const a = new PageAccounting();
    a.onNavigation(7, 5, "r");
    a.onThirdParty(7, "x.example");
    expect(a.onTabRemoved(7)).toEqual({ count: 1, startedAt: 5 });
    expect(a.onTabRemoved(7)).toBeNull();
  });
  it("does not count a repeated start with the same request id (redirect hop)", () => {
    const a = new PageAccounting();
    expect(a.onNavigation(1, 0, "same").counted).toBe(true);
    a.onThirdParty(1, "x.example");
    expect(a.onNavigation(1, 1, "same")).toEqual({ counted: false, finalised: null });
    expect(a.onTabRemoved(1)?.count).toBe(1);
  });
  it("ignores third-party domains for unknown tabs", () => {
    const a = new PageAccounting();
    a.onThirdParty(9, "x.example");
    expect(a.onTabRemoved(9)).toBeNull();
  });
});

describe("day mutations", () => {
  it("counts a new known_infra detection once into contacts and hosts", () => {
    const day = emptyDay("2026-11-05");
    applyNewDetection(day, det("known_infra.exact", "informational"), "h.example");
    applyNewDetection(day, det("known_infra.exact", "informational"), "h.example");
    expect(day.contacts).toBe(2); // two new detections; the host list stays distinct
    expect(day.hosts).toEqual(["h.example"]);
    expect(day.strong).toBe(0);
  });
  it("counts elevated and high_priority as strong for any rule, not lower severities", () => {
    const day = emptyDay("2026-11-05");
    applyNewDetection(day, det("profiling.x", "suspicious"), undefined);
    applyNewDetection(day, det("profiling.x", "elevated"), undefined);
    applyNewDetection(day, det("known_infra.exact", "high_priority"), "a.example");
    expect(day.strong).toBe(2);
    expect(day.contacts).toBe(1);
  });
  it("caps hosts at 50", () => {
    const day = emptyDay("2026-11-05");
    for (let i = 0; i < 60; i++)
      applyNewDetection(day, det("known_infra.exact", "informational"), `h${i}.example`);
    expect(day.hosts.length).toBe(MAX_DAY_HOSTS);
  });
  it("accumulates pages, measured pages, total and max", () => {
    const day = emptyDay("2026-11-05");
    applyPageStarted(day);
    applyPageStarted(day);
    applyPageFinalised(day, 4);
    applyPageFinalised(day, 9);
    expect(day).toMatchObject({
      pages: 2,
      pagesMeasured: 2,
      thirdPartyDomainsTotal: 13,
      thirdPartyDomainsMax: 9,
    });
  });
});

describe("sanitiseDay", () => {
  it("accepts a well-formed record and drops malformed ones", () => {
    const ok: DayStats = { ...emptyDay("2026-11-05"), pages: 3, hosts: ["b.example", "a.example"] };
    expect(sanitiseDay("2026-11-05", ok)?.hosts).toEqual(["a.example", "b.example"]);
    expect(sanitiseDay("2026-11-06", ok)).toBeNull(); // key mismatch
    expect(sanitiseDay("nope", { ...ok, date: "nope" })).toBeNull();
    expect(sanitiseDay("2026-11-05", { ...ok, pages: "3" })).toBeNull();
    expect(sanitiseDay("2026-11-05", { ...ok, hosts: [1] })).toBeNull();
    expect(sanitiseDay("2026-11-05", null)).toBeNull();
  });
});

describe("buildDigest", () => {
  const day = (date: string, measured: number, total: number, contacts = 0): DayStats => ({
    ...emptyDay(date),
    pages: measured,
    pagesMeasured: measured,
    thirdPartyDomainsTotal: total,
    contacts,
    hosts: contacts ? ["h.example"] : [],
  });
  it("normal uses only the 30 days before today", () => {
    const now = at(2026, 11, 5);
    const days = [
      day("2026-11-05", 10, 1000), // today: excluded
      day("2026-11-04", 2, 20), // included
      day("2026-10-06", 2, 40), // 30 days before: included
      day("2026-10-05", 100, 100000), // 31 days before: excluded
    ];
    const d = buildDigest(days, now);
    expect(d.today).toBe("2026-11-05");
    expect(d.normalThirdPartyPerPage).toBe(15);
  });
  it("normal is null without measured pages; lastContact is the newest day with contacts", () => {
    const now = at(2026, 11, 5);
    expect(buildDigest([day("2026-11-04", 0, 0)], now).normalThirdPartyPerPage).toBeNull();
    const d = buildDigest([day("2026-11-04", 1, 1), day("2026-11-03", 1, 1, 2)], now);
    expect(d.lastContact).toEqual({ date: "2026-11-03", hosts: ["h.example"] });
    expect(buildDigest([], now).lastContact).toBeNull();
  });
});

describe("documentedHostFor", () => {
  const recs = new Map([
    ["d1", { id: "d1", indicator: "tracker.example", indicatorType: "domain" as const }],
    ["h1", { id: "h1", indicator: "c2.example", indicatorType: "hostname" as const }],
    ["hp", { id: "hp", indicator: "an.example", indicatorType: "hostname_path" as const }],
    ["u1", { id: "u1", indicator: "/getAd", indicatorType: "url_path" as const }],
  ]);
  const withIds = (ids: string[], subjects: string[]): Detection =>
    ({
      ruleId: "known_infra.x",
      severity: "info",
      subjectHostnames: subjects,
      matchedIndicatorIds: ids,
    }) as unknown as Detection;

  it("returns the indicator name for a domain match even when the subject is a subdomain", () => {
    expect(documentedHostFor(withIds(["d1"], ["a.b.tracker.example"]), recs)).toBe(
      "tracker.example",
    );
  });
  it("returns the hostname for hostname and hostname_path kinds", () => {
    expect(documentedHostFor(withIds(["h1"], ["c2.example"]), recs)).toBe("c2.example");
    expect(documentedHostFor(withIds(["hp"], ["an.example"]), recs)).toBe("an.example");
  });
  it("returns undefined for url_path kind, never the first-party subject host", () => {
    expect(documentedHostFor(withIds(["u1"], ["news.example"]), recs)).toBeUndefined();
  });
  it("returns undefined for unknown ids", () => {
    expect(documentedHostFor(withIds(["nope"], ["news.example"]), recs)).toBeUndefined();
  });
});

describe("isTopLevelNavigation", () => {
  const nav = (over: Record<string, unknown> = {}, frameId = 0): NormalizedEvent =>
    ({
      resourceType: "main_frame",
      eventType: "request_started",
      tabId: 5,
      frameContext: { frameId },
      ...over,
    }) as unknown as NormalizedEvent;

  it("accepts a normal top-level navigation", () => {
    expect(isTopLevelNavigation(nav())).toBe(true);
  });
  it("rejects non-zero frames (Chromium prerender)", () => {
    expect(isTopLevelNavigation(nav({}, 3))).toBe(false);
  });
  it("rejects redirects", () => {
    expect(isTopLevelNavigation(nav({ eventType: "request_redirected" }))).toBe(false);
  });
  it("rejects tabId -1 and missing tab", () => {
    expect(isTopLevelNavigation(nav({ tabId: -1 }))).toBe(false);
    expect(isTopLevelNavigation(nav({ tabId: undefined }))).toBe(false);
  });
  it("rejects non main_frame", () => {
    expect(isTopLevelNavigation(nav({ resourceType: "script" }))).toBe(false);
  });
});
