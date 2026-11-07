/**
 * "Seen alongside": hostnames that appear in the same frame lineage as a documented host.
 *
 * Observation only. Never a detection, never a severity, never a verdict about the candidate.
 * The tracker is a pure consumer of events: it reads what the detection engine has already
 * ingested and has no write path into the engine, so it cannot change a detection.
 *
 * Anchor: an event whose destination matches an enabled, non-expired indicator classified
 * "surveillance" or "malicious" ("contextual" never anchors; heuristic rules never anchor).
 * Candidate: a later or earlier event (within ALONGSIDE_WINDOW_MS) whose destination host is
 * lineage-"related" to the anchor event, is not the anchor host, matches no indicator and is
 * not an IP literal or loopback name. Lineage "unknown" (same tab only, no ancestry) is never
 * recorded: that would be the whole page.
 *
 * Scope: "frame" when the anchor sits in a sub-frame (frameId > 0); "page" when it sits in the
 * top document (frameId 0), where "related" degrades to "loaded by the page". Only "frame"
 * counts toward the ranking in `listAlongside`.
 *
 * Privacy: the store holds hostnames, indicator ids and UTC day keys. No URL, path, query,
 * page host, tab id or timestamp.
 */
import {
  lineageRelation,
  type IndicatorClassification,
  type NormalizedEvent,
} from "@adtripwire/shared";
import { isIpAddress, normalizeHostname, type IndicatorMatcher } from "@adtripwire/indicators";
import { clusterDomain } from "./cluster.js";

export const ALONGSIDE_WINDOW_MS = 60_000;
export const ALONGSIDE_MAX_OPEN_ANCHORS = 32;
export const ALONGSIDE_MAX_HOSTS = 500;
export const ALONGSIDE_MAX_DAYS = 60;
export const ALONGSIDE_MAX_ANCHORS_PER_HOST = 8;
/** Minimum frame-scope alongside-days before a host is listed in the ranking. */
export const ALONGSIDE_MIN_DAYS = 2;
export const ALONGSIDE_STORAGE_KEY = "alongside.v1";

export type AlongsideScope = "frame" | "page";

const ANCHOR_CLASSES: ReadonlySet<IndicatorClassification> = new Set(["surveillance", "malicious"]);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9._-]{0,251}[a-z0-9])?$/;
const INDICATOR_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const COUNTER_MAX = 1_000_000_000;
const NAV_TABS_MAX = 256;

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Per-host record. All day arrays are sorted, distinct, and capped at the newest 60. */
export interface AlongsideHostRecord {
  /** Days with any alongside observation (frame or page scope). */
  days: string[];
  /** Indicator ids of the anchors the host was seen alongside (≤ 8, newest kept). */
  anchors: string[];
  /** Days with frame-scope observations (counts toward ranking). */
  frameDays: string[];
  /** Days with page-scope observations (shown separately). */
  pageDays: string[];
  /**
   * Monotonic observation counters, bumped on every recorded relation (not deduplicated by day).
   * They let a reader tell that a host was seen alongside again on the same day; counts only.
   */
  frameHits: number;
  pageHits: number;
}

export interface AlongsideTotals {
  /** Anchors opened since the store was created (or last deleted). */
  anchorsSeen: number;
  frameAnchors: number;
  pageAnchors: number;
  /** Distinct UTC days (newest 60) on which at least one anchor opened. */
  anchorDays: string[];
}

export interface AlongsideSnapshot {
  version: 1;
  totals: AlongsideTotals;
  /** Oldest first (LRU order); hostname -> record. */
  hosts: Array<[string, AlongsideHostRecord]>;
}

function addSorted(list: string[], value: string, max: number): boolean {
  if (list.includes(value)) return false;
  list.push(value);
  list.sort();
  while (list.length > max) list.shift();
  return true;
}

function cleanDays(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const d of v) if (typeof d === "string" && DAY_KEY.test(d)) out.add(d);
  return [...out].sort().slice(-ALONGSIDE_MAX_DAYS);
}

function cleanCounter(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.min(Math.floor(v), COUNTER_MAX)
    : 0;
}

/** Bounded, LRU, JSON-serialisable store of alongside observations. */
export class AlongsideStore {
  readonly #hosts = new Map<string, AlongsideHostRecord>();
  #totals: AlongsideTotals = { anchorsSeen: 0, frameAnchors: 0, pageAnchors: 0, anchorDays: [] };

  get size(): number {
    return this.#hosts.size;
  }

  get totals(): Readonly<AlongsideTotals> {
    return this.#totals;
  }

  get(hostname: string): Readonly<AlongsideHostRecord> | undefined {
    return this.#hosts.get(hostname);
  }

  /** Records are returned oldest-used first. */
  entries(): IterableIterator<[string, Readonly<AlongsideHostRecord>]> {
    return this.#hosts.entries();
  }

  /** Counts an opened anchor. Returns true (the store changed). */
  noteAnchor(scope: AlongsideScope, day: string): boolean {
    const t = this.#totals;
    t.anchorsSeen = Math.min(t.anchorsSeen + 1, COUNTER_MAX);
    if (scope === "frame") t.frameAnchors = Math.min(t.frameAnchors + 1, COUNTER_MAX);
    else t.pageAnchors = Math.min(t.pageAnchors + 1, COUNTER_MAX);
    addSorted(t.anchorDays, day, ALONGSIDE_MAX_DAYS);
    return true;
  }

  /** Records one observation. Returns true when the store content changed (always, once valid). */
  record(hostname: string, indicatorId: string, scope: AlongsideScope, day: string): boolean {
    if (!HOSTNAME.test(hostname) || !DAY_KEY.test(day) || !INDICATOR_ID.test(indicatorId))
      return false;
    const existing = this.#hosts.get(hostname);
    const rec: AlongsideHostRecord = existing ?? {
      days: [],
      anchors: [],
      frameDays: [],
      pageDays: [],
      frameHits: 0,
      pageHits: 0,
    };
    // Re-insert to mark as most recently used.
    this.#hosts.delete(hostname);
    this.#hosts.set(hostname, rec);
    if (scope === "frame") rec.frameHits = Math.min(rec.frameHits + 1, COUNTER_MAX);
    else rec.pageHits = Math.min(rec.pageHits + 1, COUNTER_MAX);
    addSorted(rec.days, day, ALONGSIDE_MAX_DAYS);
    addSorted(scope === "frame" ? rec.frameDays : rec.pageDays, day, ALONGSIDE_MAX_DAYS);
    if (!rec.anchors.includes(indicatorId)) {
      rec.anchors.push(indicatorId);
      while (rec.anchors.length > ALONGSIDE_MAX_ANCHORS_PER_HOST) rec.anchors.shift();
    }
    while (this.#hosts.size > ALONGSIDE_MAX_HOSTS) {
      // Least recently used first, but page-scope-only hosts go before any frame-scope host:
      // one busy top-document anchor must not push the ranked candidates out.
      let victim: string | undefined;
      for (const [h, r] of this.#hosts) {
        victim ??= h;
        if (r.frameDays.length === 0) {
          victim = h;
          break;
        }
      }
      if (victim === undefined) break;
      this.#hosts.delete(victim);
    }
    // Every valid observation moves a hit counter, so the store always changed.
    return true;
  }

  /** Drops day keys older than `minDay` (YYYY-MM-DD) and hosts left without any day. */
  pruneBefore(minDay: string): void {
    for (const [h, r] of [...this.#hosts]) {
      r.days = r.days.filter((d) => d >= minDay);
      r.frameDays = r.frameDays.filter((d) => d >= minDay);
      r.pageDays = r.pageDays.filter((d) => d >= minDay);
      if (r.days.length === 0) this.#hosts.delete(h);
    }
    this.#totals.anchorDays = this.#totals.anchorDays.filter((d) => d >= minDay);
  }

  toJSON(): AlongsideSnapshot {
    return {
      version: 1,
      totals: { ...this.#totals, anchorDays: [...this.#totals.anchorDays] },
      hosts: [...this.#hosts].map(([h, r]) => [
        h,
        {
          days: [...r.days],
          anchors: [...r.anchors],
          frameDays: [...r.frameDays],
          pageDays: [...r.pageDays],
          frameHits: r.frameHits,
          pageHits: r.pageHits,
        },
      ]),
    };
  }

  /** Defensive: anything malformed is dropped, never thrown. */
  static fromJSON(snapshot: unknown): AlongsideStore {
    const store = new AlongsideStore();
    if (typeof snapshot !== "object" || snapshot === null) return store;
    const s = snapshot as { totals?: unknown; hosts?: unknown };
    if (typeof s.totals === "object" && s.totals !== null) {
      const t = s.totals as Record<string, unknown>;
      store.#totals = {
        anchorsSeen: cleanCounter(t["anchorsSeen"]),
        frameAnchors: cleanCounter(t["frameAnchors"]),
        pageAnchors: cleanCounter(t["pageAnchors"]),
        anchorDays: cleanDays(t["anchorDays"]),
      };
    }
    if (!Array.isArray(s.hosts)) return store;
    for (const entry of s.hosts.slice(-ALONGSIDE_MAX_HOSTS)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [host, raw] = entry as [unknown, unknown];
      if (typeof host !== "string" || !HOSTNAME.test(host)) continue;
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const frameDays = cleanDays(r["frameDays"]);
      const pageDays = cleanDays(r["pageDays"]);
      const days = cleanDays([...cleanDays(r["days"]), ...frameDays, ...pageDays]);
      if (days.length === 0) continue;
      const anchors: string[] = [];
      if (Array.isArray(r["anchors"]))
        for (const a of r["anchors"])
          if (typeof a === "string" && INDICATOR_ID.test(a) && !anchors.includes(a))
            anchors.push(a);
      store.#hosts.set(host, {
        days,
        anchors: anchors.slice(-ALONGSIDE_MAX_ANCHORS_PER_HOST),
        frameDays,
        pageDays,
        frameHits: cleanCounter(r["frameHits"]),
        pageHits: cleanCounter(r["pageHits"]),
      });
    }
    return store;
  }
}

/** True for hosts that can never be a candidate: IP literals and loopback names. */
function isLocalOrIp(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || isIpAddress(host);
}

interface OpenAnchor {
  indicatorId: string;
  host: string;
  scope: AlongsideScope;
  /** Registrable domain of the page (top document) the anchor was seen on. */
  topSite: string;
  /** The anchor event; kept (bounded by ALONGSIDE_MAX_OPEN_ANCHORS) for lineage tests. */
  event: NormalizedEvent;
  openedAt: number;
}

export interface AlongsideTrackerOptions {
  /** Current matcher; a function so a rebuilt matcher (indicator set toggled) is picked up. */
  matcher: () => IndicatorMatcher;
  /** Store to write to; a fresh one when omitted. */
  store?: AlongsideStore;
  windowMs?: number;
  maxOpenAnchors?: number;
}

/**
 * Registry of open anchors. Feed every event the detection engine ingested through `observe`
 * (after `engine.ingest`), passing the engine window's recent events.
 */
export class AlongsideTracker {
  readonly store: AlongsideStore;
  readonly #matcher: () => IndicatorMatcher;
  readonly #windowMs: number;
  readonly #maxOpen: number;
  #open: OpenAnchor[] = [];
  #clock = 0;
  /** tabId -> timestamp of its latest top-level navigation (bounded). */
  readonly #navAt = new Map<number, number>();

  constructor(opts: AlongsideTrackerOptions) {
    this.#matcher = opts.matcher;
    this.store = opts.store ?? new AlongsideStore();
    this.#windowMs = opts.windowMs ?? ALONGSIDE_WINDOW_MS;
    this.#maxOpen = opts.maxOpenAnchors ?? ALONGSIDE_MAX_OPEN_ANCHORS;
  }

  get openAnchors(): number {
    return this.#open.length;
  }

  /**
   * Copies the per-tab navigation times from `prev` (the tracker this one replaces, e.g. when the
   * stored snapshot is restored after startup), so navigations seen before the swap still close
   * the backward scan. Open anchors are not copied.
   */
  inheritNavigation(prev: AlongsideTracker): void {
    for (const [tabId, ts] of prev.#navAt) this.onNavigation(tabId, ts);
  }

  /**
   * A top-level navigation started in `tabId` at `timestamp`: close that tab's open anchors and
   * ignore every earlier event of the tab from now on (a new page never inherits the previous
   * page's anchors, and the backward scan never reaches into the previous page).
   */
  onNavigation(tabId: number, timestamp: number): void {
    this.#open = this.#open.filter((a) => a.event.tabId !== tabId);
    this.#navAt.delete(tabId);
    this.#navAt.set(tabId, Math.max(timestamp, this.#navAt.get(tabId) ?? 0));
    while (this.#navAt.size > NAV_TABS_MAX) {
      const oldest = this.#navAt.keys().next().value;
      if (oldest === undefined) break;
      this.#navAt.delete(oldest);
    }
  }

  /** True when the event predates its tab's latest top-level navigation. */
  #stale(ev: NormalizedEvent): boolean {
    if (ev.tabId === undefined) return false;
    const nav = this.#navAt.get(ev.tabId);
    return nav !== undefined && ev.timestamp < nav;
  }

  /**
   * @param ev the event just ingested.
   * @param recent events currently in the correlation window (may include `ev`); only called
   *   when `ev` opens an anchor, so passing a window accessor costs nothing per event.
   * @returns true when the store changed (the caller should schedule a persist).
   */
  observe(ev: NormalizedEvent, recent: () => readonly NormalizedEvent[]): boolean {
    if (ev.eventType === "page_signal") return false;
    this.#clock = Math.max(this.#clock, ev.timestamp);
    this.#open = this.#open.filter((a) => this.#clock - a.openedAt <= this.#windowMs);
    let changed = false;

    // Forward: this event as a candidate for anchors that are already open.
    const host = this.#candidateHost(ev);
    if (host !== undefined) {
      for (const a of this.#open) {
        if (this.#related(a, ev, host)) changed = this.#record(host, a, ev.timestamp) || changed;
      }
    }

    // This event as an anchor: open it and scan the window backwards.
    const anchor = this.#anchorFor(ev);
    if (anchor === undefined) return changed;
    if (
      this.#open.some(
        (a) =>
          a.indicatorId === anchor.indicatorId &&
          a.event.tabId === ev.tabId &&
          a.event.frameContext.frameId === ev.frameContext.frameId,
      )
    )
      return changed;
    if (this.#open.length >= this.#maxOpen) this.#open.shift();
    this.#open.push(anchor);
    changed = this.store.noteAnchor(anchor.scope, dayKey(ev.timestamp)) || changed;
    for (const cand of recent()) {
      if (cand.eventId === ev.eventId || cand.eventType === "page_signal") continue;
      if (Math.abs(cand.timestamp - ev.timestamp) > this.#windowMs) continue;
      const h = this.#candidateHost(cand);
      if (h === undefined || !this.#related(anchor, cand, h)) continue;
      changed = this.#record(h, anchor, cand.timestamp) || changed;
    }
    return changed;
  }

  #anchorFor(ev: NormalizedEvent): OpenAnchor | undefined {
    const frameId = ev.frameContext.frameId;
    if (frameId < 0 || this.#stale(ev)) return undefined;
    // Fail closed: without the page's site the page's own hosts cannot be told from candidates.
    const top = ev.frameContext.topHostname;
    if (top === undefined || top === "") return undefined;
    const host = normalizeHostname(ev.destination.hostname);
    if (host === null) return undefined;
    const m = this.#matcher()
      .match(host, ev.destination.pathPattern, ev.timestamp)
      .find((x) => x.validity === "current" && ANCHOR_CLASSES.has(x.indicator.classification));
    if (m === undefined) return undefined;
    return {
      indicatorId: m.indicator.id,
      host,
      scope: frameId > 0 ? "frame" : "page",
      topSite: clusterDomain(top),
      event: ev,
      openedAt: ev.timestamp,
    };
  }

  /** Normalised candidate hostname, or undefined when the event cannot be a candidate. */
  #candidateHost(ev: NormalizedEvent): string | undefined {
    const host = normalizeHostname(ev.destination.hostname);
    if (host === null || isLocalOrIp(host) || !HOSTNAME.test(host)) return undefined;
    if (this.#matcher().match(host, ev.destination.pathPattern, ev.timestamp).length > 0)
      return undefined;
    return host;
  }

  #related(a: OpenAnchor, cand: NormalizedEvent, candHost: string): boolean {
    if (candHost === a.host) return false;
    if (Math.abs(cand.timestamp - a.openedAt) > this.#windowMs) return false;
    if (this.#stale(cand)) return false;
    // The page's own site is never a candidate (first-party wrapper frames, first-party
    // requests inside an ad frame); ancestor ad-tech hosts of other sites are not excluded.
    if (clusterDomain(candHost) === a.topSite) return false;
    // The candidate must belong to the same page site as the anchor.
    const candTop = cand.frameContext.topHostname;
    if (candTop !== undefined && candTop !== "" && clusterDomain(candTop) !== a.topSite)
      return false;
    // A frame-scope anchor never claims top-document events: a sub_frame anchor is
    // "loaded by" frame 0, which lineageRelation reports as related to the whole page.
    if (a.scope === "frame" && cand.frameContext.frameId <= 0) return false;
    return lineageRelation(a.event, cand) === "related";
  }

  #record(host: string, a: OpenAnchor, ts: number): boolean {
    return this.store.record(host, a.indicatorId, a.scope, dayKey(ts));
  }
}

/** Anything with a distinct-day count per registrable domain (MemoryExposureStore fits). */
export interface DayCounter {
  distinctDays(key: string): number;
}

export interface AlongsideRow {
  hostname: string;
  /** Frame-scope days (the ranking count). */
  alongsideDays: number;
  /** Days the host's registrable domain was seen as a third party at all (≥ alongsideDays). */
  seenDays: number;
  /** alongsideDays / seenDays, 0..1. */
  share: number;
  /** Indicator ids of the documented hosts it was seen alongside. */
  anchors: string[];
  frameDays: number;
  pageDays: number;
  /** Newest UTC day key (YYYY-MM-DD) of any observation. */
  lastSeen: string;
}

export interface AlongsideListing {
  /** Frame-scope hosts with ≥ minAlongsideDays, ranked by share, then days, then recency. */
  rows: AlongsideRow[];
  /** Hosts seen only at page scope (alongsideDays 0), most page-days first. */
  pageOnly: AlongsideRow[];
  totals: {
    anchorsSeen: number;
    frameAnchors: number;
    pageAnchors: number;
    anchorDays: number;
    hostsTracked: number;
    /** Hosts with any frame-scope day, listed or not. */
    frameHosts: number;
    minAlongsideDays: number;
  };
}

/** One row of the "all hosts" view: every tracked host with its raw counters, unranked. */
export interface AlongsideAllRow extends AlongsideRow {
  /** Monotonic counters (see AlongsideHostRecord); a reader diffs them between two reads. */
  frameHits: number;
  pageHits: number;
}

/** `get_alongside` with `all: true`: the ranked listing plus every tracked host. */
export interface AlongsideAllListing extends AlongsideListing {
  hosts: AlongsideAllRow[];
}

export interface ListAlongsideOptions {
  minAlongsideDays?: number;
  /** Cap per list; default 200. */
  limit?: number;
}

export function listAlongside(
  store: AlongsideStore,
  baseline: DayCounter,
  opts: ListAlongsideOptions = {},
): AlongsideListing {
  const min = opts.minAlongsideDays ?? ALONGSIDE_MIN_DAYS;
  const limit = opts.limit ?? 200;
  const rows: AlongsideRow[] = [];
  const pageOnly: AlongsideRow[] = [];
  let frameHosts = 0;
  for (const [hostname, r] of store.entries()) {
    const alongside = r.frameDays.length;
    const seen = Math.max(baseline.distinctDays(clusterDomain(hostname)), alongside);
    const row: AlongsideRow = {
      hostname,
      alongsideDays: alongside,
      seenDays: seen,
      share: seen > 0 ? alongside / seen : 0,
      anchors: [...r.anchors],
      frameDays: alongside,
      pageDays: r.pageDays.length,
      lastSeen: r.days[r.days.length - 1] ?? "",
    };
    if (alongside > 0) frameHosts++;
    if (alongside >= min) rows.push(row);
    else if (alongside === 0 && row.pageDays > 0) pageOnly.push(row);
  }
  rows.sort(
    (a, b) =>
      b.share - a.share ||
      b.alongsideDays - a.alongsideDays ||
      (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0) ||
      (a.hostname < b.hostname ? -1 : a.hostname > b.hostname ? 1 : 0),
  );
  pageOnly.sort(
    (a, b) =>
      b.pageDays - a.pageDays || (a.hostname < b.hostname ? -1 : a.hostname > b.hostname ? 1 : 0),
  );
  const t = store.totals;
  return {
    rows: rows.slice(0, limit),
    pageOnly: pageOnly.slice(0, limit),
    totals: {
      anchorsSeen: t.anchorsSeen,
      frameAnchors: t.frameAnchors,
      pageAnchors: t.pageAnchors,
      anchorDays: t.anchorDays.length,
      hostsTracked: store.size,
      frameHosts,
      minAlongsideDays: min,
    },
  };
}

/**
 * Every tracked host (no minimum, no ranking cut) with its hit counters, for readers that
 * compute deltas between two reads (the observatory rig). Same privacy content as the store.
 */
export function listAlongsideAll(
  store: AlongsideStore,
  baseline: DayCounter,
  opts: ListAlongsideOptions = {},
): AlongsideAllListing {
  const listing = listAlongside(store, baseline, opts);
  const hosts: AlongsideAllRow[] = [];
  for (const [hostname, r] of store.entries()) {
    const alongside = r.frameDays.length;
    const seen = Math.max(baseline.distinctDays(clusterDomain(hostname)), alongside);
    hosts.push({
      hostname,
      alongsideDays: alongside,
      seenDays: seen,
      share: seen > 0 ? alongside / seen : 0,
      anchors: [...r.anchors],
      frameDays: alongside,
      pageDays: r.pageDays.length,
      lastSeen: r.days[r.days.length - 1] ?? "",
      frameHits: r.frameHits,
      pageHits: r.pageHits,
    });
  }
  hosts.sort((a, b) => (a.hostname < b.hostname ? -1 : a.hostname > b.hostname ? 1 : 0));
  return { ...listing, hosts };
}
