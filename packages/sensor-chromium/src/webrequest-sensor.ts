import type { NormalizedEvent } from "@adtripwire/shared";
import type { SensorOptions } from "@adtripwire/sensor-firefox";
import { buildChromiumEvent, type ChromiumRequestDetails } from "./event-builder.js";
import { FrameTreeCache, type FrameLookupApi, type NavigationDetailsLike } from "./frame-tree.js";

/**
 * The Firefox sensor contract, with the inspection-only fields optional: Chromium MV3 cannot
 * read response bodies, so `shouldInspect`, `analyzer`, `maxInspectBytes` and
 * `inspectionMatchPatterns` are accepted (a Firefox `SensorOptions` object is assignable)
 * but never used.
 */
export type ChromiumSensorOptions = Omit<
  SensorOptions,
  "shouldInspect" | "analyzer" | "maxInspectBytes" | "inspectionMatchPatterns"
> &
  Partial<
    Pick<
      SensorOptions,
      "shouldInspect" | "analyzer" | "maxInspectBytes" | "inspectionMatchPatterns"
    >
  >;

/** Event shape shared by chrome.events.Event. Filters and extraInfoSpec are passed through. */
export interface EventLike<TCallback extends (...args: never[]) => unknown> {
  addListener(callback: TCallback, ...rest: never[]): void;
  removeListener(callback: TCallback): void;
}

export interface WebRequestEventLike {
  addListener(
    callback: (details: ChromiumRequestDetails) => void,
    filter: { urls: string[] },
    extraInfoSpec?: string[],
  ): void;
  removeListener(callback: (details: ChromiumRequestDetails) => void): void;
}

export interface TabLike {
  id?: number | undefined;
  incognito: boolean;
}

/**
 * Minimal slice of the `chrome` namespace the sensor uses, promise-based (MV3 returns
 * promises when no callback is passed). `chrome` itself satisfies it (see `asChromeLike`).
 */
export interface ChromeLike {
  webRequest: {
    onBeforeRequest: WebRequestEventLike;
    onBeforeRedirect: WebRequestEventLike;
    onCompleted: WebRequestEventLike;
    onErrorOccurred: WebRequestEventLike;
  };
  webNavigation?: FrameLookupApi & {
    onBeforeNavigate: EventLike<(d: NavigationDetailsLike) => void>;
    onCommitted: EventLike<(d: NavigationDetailsLike) => void>;
  };
  tabs?: {
    onCreated: EventLike<(tab: TabLike) => void>;
    onUpdated: EventLike<(tabId: number, changeInfo: unknown, tab: TabLike) => void>;
    onRemoved: EventLike<(tabId: number, removeInfo: unknown) => void>;
    query(queryInfo: Record<string, never>): Promise<TabLike[]>;
    get(tabId: number): Promise<TabLike>;
  };
  extension?: {
    isAllowedIncognitoAccess(): Promise<boolean>;
  };
}

export interface ChromiumSensorDeps {
  /** The `chrome` namespace (or a fake in tests). */
  api: ChromeLike;
  /** Optional prebuilt frame tree (tests, or sharing with another consumer). */
  frameTree?: FrameTreeCache;
}

const PENDING_TTL_MS = 60_000;
const PENDING_MAX = 5000;
const TAB_CACHE_MAX = 2000;
/** Events buffered while the incognito cache is being primed after a service-worker wake. */
const PRIME_QUEUE_MAX = 2000;
const PRIME_TIMEOUT_MS = 3000;
const WEB_REQUEST_FILTER = { urls: ["<all_urls>"] };

interface Pending {
  started: NormalizedEvent;
  createdAt: number;
}

/**
 * Chromium MV3 webRequest sensor. Registers ONLY non-blocking observers on <all_urls>
 * (started, redirected, completed with responseHeaders, error). It never blocks, never
 * attaches a response filter (Chromium has none) and never emits response_inspected events.
 * Every event carries `no_response_body_access` so detections can explain the gap.
 */
export class ChromiumWebRequestSensor {
  readonly frameTree: FrameTreeCache;
  private readonly api: ChromeLike;
  private readonly pending = new Map<string, Pending>();
  private readonly tabIncognito = new Map<number, boolean>();
  private readonly tabLookups = new Set<number>();
  private incognitoPossible: boolean | undefined;
  private primed = false;
  private primeQueue: Array<() => void> = [];
  private droppedUnknownTab = 0;
  private droppedPrimeOverflow = 0;
  private registered = false;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private primeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly removers: Array<() => void> = [];

  constructor(
    private readonly opts: ChromiumSensorOptions,
    deps: ChromiumSensorDeps,
  ) {
    this.api = deps.api;
    this.frameTree = deps.frameTree ?? new FrameTreeCache(deps.api.webNavigation);
  }

  /**
   * Registers every listener synchronously (MV3: listeners must be added in the first turn
   * of the service worker), then primes the tab cache asynchronously.
   */
  register(): void {
    if (this.registered) return;
    this.registered = true;
    const wr = this.api.webRequest;
    this.listen(wr.onBeforeRequest, (d) => this.gate(() => this.onStarted(d)));
    this.listen(wr.onBeforeRedirect, (d) => this.gate(() => this.onRedirected(d)));
    this.listen(wr.onCompleted, (d) => this.gate(() => this.onCompleted(d)), ["responseHeaders"]);
    this.listen(wr.onErrorOccurred, (d) => this.gate(() => this.onError(d)));

    const nav = this.api.webNavigation;
    if (nav) {
      this.on(nav.onBeforeNavigate, (d: NavigationDetailsLike) =>
        this.frameTree.onBeforeNavigate(d),
      );
      this.on(nav.onCommitted, (d: NavigationDetailsLike) => this.frameTree.onCommitted(d));
    } else {
      this.opts.onLog?.(
        "warn",
        "webNavigation unavailable: frame ancestry cannot be reconstructed",
      );
    }

    const tabs = this.api.tabs;
    if (tabs) {
      this.on(tabs.onCreated, (tab: TabLike) => this.rememberTab(tab));
      this.on(tabs.onUpdated, (_id: number, _c: unknown, tab: TabLike) => this.rememberTab(tab));
      this.on(tabs.onRemoved, (tabId: number) => {
        this.tabIncognito.delete(tabId);
        this.frameTree.onTabRemoved(tabId);
      });
    }

    this.sweepTimer = setInterval(() => this.sweep(Date.now()), 15_000);
    void this.prime();
  }

  /** Diagnostics for the dashboard and tests. Inspection counters are always 0 on Chromium. */
  get stats(): {
    pending: number;
    activeFilters: number;
    skippedForBudget: number;
    queuedUntilPrimed: number;
    droppedUnknownTab: number;
    droppedPrimeOverflow: number;
  } {
    return {
      pending: this.pending.size,
      activeFilters: 0,
      skippedForBudget: 0,
      queuedUntilPrimed: this.primeQueue.length,
      droppedUnknownTab: this.droppedUnknownTab,
      droppedPrimeOverflow: this.droppedPrimeOverflow,
    };
  }

  /** Resolves once the incognito cache is primed (or priming gave up). For tests and startup. */
  async ready(): Promise<void> {
    await this.primePromise;
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.primeTimer) clearTimeout(this.primeTimer);
    for (const r of this.removers.splice(0)) {
      try {
        r();
      } catch {
        // ignore
      }
    }
    this.primeQueue = [];
    this.pending.clear();
    this.registered = false;
  }

  private primePromise: Promise<void> = Promise.resolve();

  private listen(
    ev: WebRequestEventLike,
    cb: (d: ChromiumRequestDetails) => void,
    extraInfoSpec?: string[],
  ): void {
    const wrapped = (d: ChromiumRequestDetails): void => {
      try {
        cb(d);
      } catch (e) {
        this.opts.onLog?.("error", `webRequest handler failed: ${String(e)}`);
      }
      // Never return anything: these are observers, not blocking listeners.
    };
    if (extraInfoSpec) ev.addListener(wrapped, WEB_REQUEST_FILTER, extraInfoSpec);
    else ev.addListener(wrapped, WEB_REQUEST_FILTER);
    this.removers.push(() => ev.removeListener(wrapped));
  }

  private on<T extends (...args: never[]) => unknown>(ev: EventLike<T>, cb: T): void {
    (ev.addListener as (cb: T) => void)(cb);
    this.removers.push(() => ev.removeListener(cb));
  }

  private prime(): Promise<void> {
    this.primePromise = (async () => {
      const done = new Promise<void>((resolve) => {
        this.primeTimer = setTimeout(resolve, PRIME_TIMEOUT_MS);
      });
      const work = (async () => {
        try {
          const allowed = await this.api.extension?.isAllowedIncognitoAccess();
          if (typeof allowed === "boolean") this.incognitoPossible = allowed;
        } catch {
          // unknown: keep checking per tab
        }
        try {
          const list = await this.api.tabs?.query({});
          for (const t of list ?? []) this.rememberTab(t);
        } catch (e) {
          this.opts.onLog?.("warn", `tabs.query failed: ${String(e)}`);
        }
      })();
      await Promise.race([work, done]);
      if (this.primeTimer) clearTimeout(this.primeTimer);
      this.primed = true;
      const queued = this.primeQueue;
      this.primeQueue = [];
      for (const run of queued) run();
    })();
    return this.primePromise;
  }

  /**
   * Until the incognito cache is primed, handler calls are queued (bounded) so that the
   * excludeIncognito setting can be honoured for events that woke the service worker.
   */
  private gate(run: () => void): void {
    if (this.primed || !this.opts.excludeIncognito()) {
      run();
      return;
    }
    if (this.primeQueue.length >= PRIME_QUEUE_MAX) {
      this.droppedPrimeOverflow++;
      return;
    }
    this.primeQueue.push(run);
  }

  private rememberTab(tab: TabLike): void {
    if (typeof tab.id !== "number" || tab.id < 0) return;
    if (this.tabIncognito.size >= TAB_CACHE_MAX && !this.tabIncognito.has(tab.id)) {
      const oldest = this.tabIncognito.keys().next().value as number;
      this.tabIncognito.delete(oldest);
    }
    this.tabIncognito.set(tab.id, tab.incognito === true);
  }

  /**
   * Incognito exclusion. Chromium webRequest details carry no `incognito` field, so the tab
   * cache is consulted. Unknown tabs fail closed (dropped) when exclusion is on; a lazy
   * tabs.get fills the cache for subsequent requests. Requests outside tabs (tabId < 0) are
   * kept only when the extension has no incognito access (the default); otherwise dropped.
   */
  private isExcludedIncognito(tabId: number): boolean {
    if (!this.opts.excludeIncognito()) return false;
    // Default install: the extension never sees incognito traffic at all.
    if (this.incognitoPossible === false) return false;
    // Incognito access granted (spanning mode): non-tab requests (e.g. an incognito site's
    // service-worker fetches, tabId -1) cannot be attributed, so they fail closed.
    if (tabId < 0) return true;
    const known = this.tabIncognito.get(tabId);
    if (known !== undefined) return known;
    this.droppedUnknownTab++;
    this.lookupTab(tabId);
    return true;
  }

  private lookupTab(tabId: number): void {
    const tabs = this.api.tabs;
    if (!tabs || this.tabLookups.has(tabId) || this.tabLookups.size > 100) return;
    this.tabLookups.add(tabId);
    tabs
      .get(tabId)
      .then((t) => this.rememberTab(t))
      .catch(() => undefined)
      .finally(() => this.tabLookups.delete(tabId));
  }

  private accept(d: ChromiumRequestDetails): boolean {
    if (!this.opts.enabled()) return false;
    if (this.isExcludedIncognito(d.tabId)) return false;
    return true;
  }

  private build(
    phase: "started" | "redirected" | "completed" | "error",
    d: ChromiumRequestDetails,
  ): NormalizedEvent | null {
    const ev = buildChromiumEvent(phase, d, this.frameTree);
    if (ev && d.tabId >= 0 && ev.observationLimitations.includes("frame_ancestry_unavailable")) {
      void this.frameTree.refresh(d.tabId);
    }
    return ev;
  }

  private onStarted(d: ChromiumRequestDetails): void {
    if (!this.accept(d)) return;
    const ev = this.build("started", d);
    if (!ev) return;
    if (!this.opts.shouldObserve(ev)) return;
    const existing = this.pending.get(d.requestId);
    if (existing) {
      // Chromium re-fires onBeforeRequest with the same requestId after a redirect.
      existing.started = ev;
      return;
    }
    if (this.pending.size >= PENDING_MAX) this.sweep(Date.now(), true);
    this.pending.set(d.requestId, { started: ev, createdAt: Date.now() });
    this.opts.onEvent(ev);
  }

  private onRedirected(d: ChromiumRequestDetails): void {
    if (!this.opts.enabled()) return;
    const p = this.pending.get(d.requestId);
    if (!p) return;
    const ev = this.build("redirected", d);
    if (!ev) return;
    if (p.started.correlationId) ev.correlationId = p.started.correlationId;
    this.opts.onEvent(ev);
  }

  private onCompleted(d: ChromiumRequestDetails): void {
    const p = this.pending.get(d.requestId);
    if (!p) return;
    this.pending.delete(d.requestId);
    // Monitoring may have been disabled while the request was in flight.
    if (!this.opts.enabled()) return;
    const ev = this.build("completed", d);
    if (ev) this.opts.onEvent(ev);
  }

  private onError(d: ChromiumRequestDetails): void {
    const p = this.pending.get(d.requestId);
    if (!p) return;
    this.pending.delete(d.requestId);
    // Monitoring may have been disabled while the request was in flight.
    if (!this.opts.enabled()) return;
    const ev = this.build("error", d);
    if (ev) this.opts.onEvent(ev);
  }

  private sweep(now: number, force = false): void {
    for (const [id, p] of this.pending) {
      if (force || now - p.createdAt > PENDING_TTL_MS) this.pending.delete(id);
      if (force && this.pending.size < PENDING_MAX / 2) break;
    }
  }
}

/** Compile-time check that the real `chrome` namespace satisfies ChromeLike. */
export function asChromeLike(c: typeof chrome): ChromeLike {
  return c;
}
