/**
 * Per-day counters for the "morning line": pages are counted, never named. Nothing here
 * holds a URL, a hostname of a visited page or the timestamp of a page; the only per-page
 * state is a bounded in-memory set of third-party domain names, discarded when the page
 * is closed by the next navigation or the tab, and reduced to a single number first.
 */
import type {
  DayStats,
  Detection,
  Digest,
  IndicatorRecord,
  NormalizedEvent,
} from "@adtripwire/shared";

export const MAX_DAY_ENTRIES = 400;
export const MAX_DAY_HOSTS = 50;
export const MAX_DAY_PAGES = 100_000;
export const MAX_TRACKED_TABS = 200;
export const MAX_DOMAINS_PER_TAB = 500;
const NORMAL_WINDOW_DAYS = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local (browser time zone) calendar date as YYYY-MM-DD. */
export function localDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar arithmetic on a YYYY-MM-DD key (not 24 h steps, so DST cannot skip or repeat a day). */
export function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return localDate(new Date(y, m - 1, d + deltaDays).getTime());
}

export const isDateKey = (s: unknown): s is string => typeof s === "string" && DATE_RE.test(s);

export function emptyDay(date: string): DayStats {
  return {
    date,
    pages: 0,
    pagesMeasured: 0,
    thirdPartyDomainsTotal: 0,
    thirdPartyDomainsMax: 0,
    contacts: 0,
    hosts: [],
    strong: 0,
  };
}

const safeCount = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 1e9) : 0;

/** Clamps counters and normalises `hosts` (distinct, sorted, at most 50). Mutates and returns. */
export function normaliseDay(day: DayStats): DayStats {
  day.pages = Math.min(safeCount(day.pages), MAX_DAY_PAGES);
  day.pagesMeasured = safeCount(day.pagesMeasured);
  day.thirdPartyDomainsTotal = safeCount(day.thirdPartyDomainsTotal);
  day.thirdPartyDomainsMax = safeCount(day.thirdPartyDomainsMax);
  day.contacts = safeCount(day.contacts);
  day.strong = safeCount(day.strong);
  day.hosts = Array.from(new Set(day.hosts)).sort().slice(0, MAX_DAY_HOSTS);
  return day;
}

/** Shape check for a stored record; returns null for anything malformed. */
export function sanitiseDay(key: string, raw: unknown): DayStats | null {
  if (!isDateKey(key) || !raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.date !== key) return null;
  for (const f of [
    "pages",
    "pagesMeasured",
    "thirdPartyDomainsTotal",
    "thirdPartyDomainsMax",
    "contacts",
    "strong",
  ])
    if (typeof r[f] !== "number" || !Number.isFinite(r[f])) return null;
  if (!Array.isArray(r.hosts) || !r.hosts.every((h) => typeof h === "string" && h.length <= 253))
    return null;
  return normaliseDay({
    date: key,
    pages: r.pages as number,
    pagesMeasured: r.pagesMeasured as number,
    thirdPartyDomainsTotal: r.thirdPartyDomainsTotal as number,
    thirdPartyDomainsMax: r.thirdPartyDomainsMax as number,
    contacts: r.contacts as number,
    hosts: r.hosts as string[],
    strong: r.strong as number,
  });
}

export interface FinalisedPage {
  /** Distinct third-party registrable domains seen while the page was current. */
  count: number;
  /** When the page's navigation started; the page belongs to that local day. */
  startedAt: number;
}

interface TabPage {
  requestId: string | undefined;
  startedAt: number;
  domains: Set<string>;
}

/**
 * Per-tab accounting of the current page's third-party domains. Bounded: at most
 * `maxTabs` tabs (oldest evicted, unmeasured) and `maxDomains` domains per tab.
 */
export class PageAccounting {
  private readonly tabs = new Map<number, TabPage>();
  constructor(
    private readonly maxTabs = MAX_TRACKED_TABS,
    private readonly maxDomains = MAX_DOMAINS_PER_TAB,
  ) {}

  get size(): number {
    return this.tabs.size;
  }

  /**
   * A top-level navigation started in `tabId`. Both browsers re-fire the start for each
   * redirect hop with the same request id; a repeat of the tab's current request id is not a
   * new page (`counted: false`, nothing finalised). Otherwise the tab's previous page, if
   * any, is finalised and returned.
   */
  onNavigation(
    tabId: number,
    now: number,
    requestId?: string,
  ): { counted: boolean; finalised: FinalisedPage | null } {
    const prev = this.tabs.get(tabId);
    if (prev && requestId !== undefined && prev.requestId === requestId)
      return { counted: false, finalised: null };
    let finalised: FinalisedPage | null = null;
    if (prev) {
      finalised = { count: prev.domains.size, startedAt: prev.startedAt };
      this.tabs.delete(tabId);
    } else if (this.tabs.size >= this.maxTabs) {
      const oldest = this.tabs.keys().next();
      if (!oldest.done) this.tabs.delete(oldest.value);
    }
    this.tabs.set(tabId, { requestId, startedAt: now, domains: new Set() });
    return { counted: true, finalised };
  }

  /** Unknown tabs are ignored so a partial count (e.g. after a restart) is never finalised. */
  onThirdParty(tabId: number, domain: string): void {
    const page = this.tabs.get(tabId);
    if (!page || page.domains.size >= this.maxDomains) return;
    page.domains.add(domain);
  }

  onTabRemoved(tabId: number): FinalisedPage | null {
    const prev = this.tabs.get(tabId);
    if (!prev) return null;
    this.tabs.delete(tabId);
    return { count: prev.domains.size, startedAt: prev.startedAt };
  }
}

// ---- day mutations (pure, applied through LocalStore.updateDay) ----

export function applyPageStarted(day: DayStats): void {
  day.pages++;
}

export function applyPageFinalised(day: DayStats, count: number): void {
  day.pagesMeasured++;
  day.thirdPartyDomainsTotal += count;
  day.thirdPartyDomainsMax = Math.max(day.thirdPartyDomainsMax, count);
}

/** Call for NEW detections only, never for severity updates of an existing one. */
export function applyNewDetection(day: DayStats, d: Detection, host: string | undefined): void {
  if (d.ruleId.startsWith("known_infra.")) {
    day.contacts++;
    if (host && day.hosts.length < MAX_DAY_HOSTS && !day.hosts.includes(host)) day.hosts.push(host);
  }
  if (d.severity === "elevated" || d.severity === "high_priority") day.strong++;
}

export type IndicatorRecordLike = Pick<IndicatorRecord, "id" | "indicator" | "indicatorType">;

/**
 * The documented name of the infrastructure a detection matched: the matched indicator's own
 * value, never the request's destination (which can be a first-party host for url_path
 * indicators). `undefined` for url_path indicators and unknown ids.
 */
export function documentedHostFor(
  d: Detection,
  indicatorsById: ReadonlyMap<string, IndicatorRecordLike>,
): string | undefined {
  for (const id of d.matchedIndicatorIds) {
    const r = indicatorsById.get(id);
    if (!r) continue;
    // For hostname_path the indicator value is the hostname; the path lives in pathPattern.
    if (r.indicatorType !== "url_path") return r.indicator;
  }
  return undefined;
}

/** Only real top-level navigations (not prerender or other non-zero frames) count as pages. */
export function isTopLevelNavigation(ev: NormalizedEvent): boolean {
  return (
    ev.resourceType === "main_frame" &&
    ev.eventType === "request_started" &&
    ev.frameContext.frameId === 0 &&
    typeof ev.tabId === "number" &&
    ev.tabId >= 0
  );
}

/** Newest-first days → digest. "Normal" uses only the 30 local days before today. */
export function buildDigest(days: DayStats[], now: number): Digest {
  const today = localDate(now);
  const from = shiftDate(today, -NORMAL_WINDOW_DAYS);
  const to = shiftDate(today, -1);
  let total = 0;
  let measured = 0;
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    total += d.thirdPartyDomainsTotal;
    measured += d.pagesMeasured;
  }
  const last = days.find((d) => d.contacts > 0);
  return {
    today,
    days: days.slice(0, MAX_DAY_ENTRIES),
    normalThirdPartyPerPage: measured > 0 ? total / measured : null,
    lastContact: last ? { date: last.date, hosts: [...last.hosts] } : null,
  };
}
