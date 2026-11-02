import type { BrowserName, NormalizedEvent, ObservationLimitation } from "@adtripwire/shared";
import { newId } from "@adtripwire/shared";
import { buildEvent, headerValue, type RequestDetailsLike } from "./event-builder.js";
import {
  attachPassThroughInspector,
  buildInspectionEvent,
  type JsAnalyzer,
  type StreamFilterLike,
} from "./response-filter.js";
import { INSPECTABLE_TYPES, isInspectableContentType, mediaTypeOf } from "./scope.js";

export interface SensorOptions {
  browserName: BrowserName;
  /** Match patterns for the blocking listener (indicator hosts + NOAS paths). */
  inspectionMatchPatterns: string[];
  /** Decides whether a given started event is relevant enough to be forwarded at all. */
  shouldObserve: (ev: NormalizedEvent) => boolean;
  /** Decides whether the response of a started event should be inspected. */
  shouldInspect: (ev: NormalizedEvent) => boolean;
  analyzer: JsAnalyzer;
  maxInspectBytes: () => number;
  excludeIncognito: () => boolean;
  enabled: () => boolean;
  onEvent: (ev: NormalizedEvent) => void;
  onLog?: (level: "info" | "warn" | "error", msg: string) => void;
  onMetrics?: (m: { passThroughMs: number; analysisMs: number; bytes: number }) => void;
}

interface Pending {
  started: NormalizedEvent;
  inspecting: boolean;
  completed?: NormalizedEvent;
  inspection?: { result: Parameters<typeof buildInspectionEvent>[1]; at: number };
  contentType?: string;
  createdAt: number;
}

const PENDING_TTL_MS = 60_000;
const PENDING_MAX = 5000;
/** Total buffered inspection memory allowed across concurrent filters. */
const INSPECTION_BUDGET_BYTES = 32 * 1024 * 1024;
const INSPECTION_MIN_CONCURRENT = 2;

/**
 * Firefox webRequest sensor. Registers:
 *  - non-blocking observers on <all_urls> (started, redirected, completed, error)
 *  - ONE blocking onBeforeRequest listener scoped to inspection match patterns, which
 *    attaches a pass-through StreamFilter. Nothing is ever cancelled, redirected or modified.
 */
export class WebRequestSensor {
  private readonly pending = new Map<string, Pending>();
  private activeFilters = 0;
  private skippedForBudget = 0;
  private registered = false;
  private filterApi: ((id: string) => StreamFilterLike) | undefined;
  private inspectListener:
    ((d: browser.webRequest._OnBeforeRequestDetails) => undefined) | undefined;
  private headersListener: ((d: browser.webRequest._OnHeadersReceivedDetails) => void) | undefined;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: SensorOptions) {}

  register(): void {
    if (this.registered) return;
    this.registered = true;
    const all = { urls: ["<all_urls>"] };

    browser.webRequest.onBeforeRequest.addListener(
      (d) => this.onStarted(d as unknown as RequestDetailsLike),
      all,
    );
    browser.webRequest.onBeforeRedirect.addListener(
      (d) => this.onRedirected(d as unknown as RequestDetailsLike),
      all,
    );
    browser.webRequest.onCompleted.addListener(
      (d) => this.onCompleted(d as unknown as RequestDetailsLike),
      all,
      ["responseHeaders"],
    );
    browser.webRequest.onErrorOccurred.addListener(
      (d) => this.onError(d as unknown as RequestDetailsLike),
      all,
    );

    this.filterApi = (
      browser.webRequest as unknown as { filterResponseData?: (id: string) => StreamFilterLike }
    ).filterResponseData;
    this.registerInspectionListeners(this.opts.inspectionMatchPatterns);
    this.activePatterns = [...this.opts.inspectionMatchPatterns];
    this.sweepTimer = setInterval(() => this.sweep(Date.now()), 15_000);
  }

  /**
   * (Re)registers the blocking inspection listener and the headers listener for the given
   * match patterns. Match patterns are fixed at registration time in WebExtensions, so a
   * changed indicator set (e.g. a user import) requires removing and re-adding the listeners.
   */
  private registerInspectionListeners(patterns: string[]): void {
    if (this.inspectListener) {
      browser.webRequest.onBeforeRequest.removeListener(this.inspectListener);
      this.inspectListener = undefined;
    }
    if (this.headersListener) {
      browser.webRequest.onHeadersReceived.removeListener(this.headersListener);
      this.headersListener = undefined;
    }
    const filterApi = this.filterApi;
    if (!filterApi || patterns.length === 0) {
      this.opts.onLog?.(
        "info",
        "response inspection not registered (API unavailable or no patterns)",
      );
      return;
    }
    this.inspectListener = (d) =>
      this.onInspectCandidate(d as unknown as RequestDetailsLike, filterApi);
    browser.webRequest.onBeforeRequest.addListener(
      this.inspectListener,
      { urls: patterns, types: Array.from(INSPECTABLE_TYPES) as browser.webRequest.ResourceType[] },
      ["blocking"],
    );
    // Content-Type is only known at headers time; stash it for the inspector.
    this.headersListener = (d) => this.onHeaders(d as unknown as RequestDetailsLike);
    browser.webRequest.onHeadersReceived.addListener(this.headersListener, { urls: patterns }, [
      "responseHeaders",
    ]);
  }

  private activePatterns: string[] = [];

  /** Swap inspection match patterns after an indicator-set change (rolls back on failure). */
  updateInspectionPatterns(patterns: string[]): void {
    if (!this.registered) {
      this.opts.inspectionMatchPatterns.splice(
        0,
        this.opts.inspectionMatchPatterns.length,
        ...patterns,
      );
      return;
    }
    const previous = this.activePatterns;
    try {
      this.registerInspectionListeners(patterns);
      this.activePatterns = patterns;
    } catch (e) {
      this.opts.onLog?.(
        "error",
        `inspection pattern update failed, restoring previous set: ${String(e)}`,
      );
      try {
        this.registerInspectionListeners(previous);
      } catch (e2) {
        this.opts.onLog?.("error", `restoring inspection patterns failed: ${String(e2)}`);
      }
    }
  }

  /** Diagnostics for the dashboard and tests. */
  get stats(): { pending: number; activeFilters: number; skippedForBudget: number } {
    return {
      pending: this.pending.size,
      activeFilters: this.activeFilters,
      skippedForBudget: this.skippedForBudget,
    };
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  private accept(d: RequestDetailsLike): boolean {
    if (!this.opts.enabled()) return false;
    if (d.incognito && this.opts.excludeIncognito()) return false;
    return true;
  }

  private onStarted(d: RequestDetailsLike): void {
    if (!this.accept(d)) return;
    const ev = buildEvent(this.opts.browserName, "started", d);
    if (!ev) return;
    if (!this.opts.shouldObserve(ev)) return;
    const existing = this.pending.get(d.requestId);
    if (existing) {
      // Same requestId seen again (redirect or listener ordering): keep inspection state,
      // do not emit a duplicate start.
      existing.started = ev;
      return;
    }
    if (this.pending.size >= PENDING_MAX) this.sweep(Date.now(), true);
    this.pending.set(d.requestId, { started: ev, inspecting: false, createdAt: Date.now() });
    this.opts.onEvent(ev);
  }

  /** Blocking listener: decides in O(1) whether to attach a filter. Never returns a blocking response. */
  private onInspectCandidate(
    d: RequestDetailsLike,
    filterApi: (id: string) => StreamFilterLike,
  ): undefined {
    try {
      if (!this.accept(d)) return undefined;
      const p = this.pending.get(d.requestId);
      // The non-blocking listener registered first usually ran already; if not, build a minimal view.
      const started = p?.started ?? buildEvent(this.opts.browserName, "started", d);
      if (!started) return undefined;
      if (!INSPECTABLE_TYPES.has(started.resourceType ?? "other")) return undefined;
      // shouldInspect is the single gate (it already covers NOAS paths and the user's
      // "response inspection" setting); nothing bypasses it.
      if (!this.opts.shouldInspect(started)) return undefined;
      const entry: Pending = p ?? { started, inspecting: false, createdAt: Date.now() };
      if (!p) {
        this.pending.set(d.requestId, entry);
        if (this.opts.shouldObserve(started)) this.opts.onEvent(started);
      }
      if (entry.inspecting) return undefined; // a filter is already attached to this request
      const maxBytes = this.opts.maxInspectBytes();
      const maxConcurrent = Math.max(
        INSPECTION_MIN_CONCURRENT,
        Math.floor(INSPECTION_BUDGET_BYTES / Math.max(1, maxBytes)),
      );
      if (this.activeFilters >= maxConcurrent) {
        this.skippedForBudget++;
        entry.started.observationLimitations.push("response_body_skipped_budget");
        if (this.skippedForBudget % 50 === 1)
          this.opts.onLog?.(
            "warn",
            `inspection skipped: ${this.activeFilters} filters active (budget)`,
          );
        return undefined;
      }
      entry.inspecting = true;
      this.activeFilters++;
      const filter = filterApi(d.requestId);
      const requestId = d.requestId;
      attachPassThroughInspector(filter, {
        maxBytes,
        analyzer: this.opts.analyzer,
        onLog: (lvl, msg) => this.opts.onLog?.(lvl, `[${requestId}] ${msg}`),
        onResult: (result) => {
          this.activeFilters = Math.max(0, this.activeFilters - 1);
          const cur = this.pending.get(requestId);
          this.opts.onMetrics?.({
            passThroughMs: result.passThroughMs,
            analysisMs: result.analysisMs,
            bytes: result.inspection.observedBytes,
          });
          if (!cur) return;
          cur.inspection = { result, at: Date.now() };
          this.tryEmitInspection(requestId, cur);
        },
      });
    } catch (e) {
      this.opts.onLog?.("error", `inspect candidate failed: ${String(e)}`);
    }
    return undefined;
  }

  private onHeaders(d: RequestDetailsLike): void {
    const p = this.pending.get(d.requestId);
    if (!p || !p.inspecting) return;
    const ct = headerValue(d.responseHeaders, "content-type");
    if (ct && !isInspectableContentType(ct)) {
      // Binary content: analysis will find nothing; the filter still passes bytes through.
      this.opts.onLog?.("info", `non-text content-type for inspected request: ${mediaTypeOf(ct)}`);
    }
    const mt = mediaTypeOf(ct);
    if (mt) p.contentType = mt;
  }

  private onRedirected(d: RequestDetailsLike): void {
    if (!this.accept(d)) return;
    const p = this.pending.get(d.requestId);
    if (!p) return;
    const ev = buildEvent(this.opts.browserName, "redirected", d);
    if (!ev) return;
    if (p.started.correlationId) ev.correlationId = p.started.correlationId;
    this.opts.onEvent(ev);
  }

  private onCompleted(d: RequestDetailsLike): void {
    const p = this.pending.get(d.requestId);
    if (!p) return;
    const ev = buildEvent(this.opts.browserName, "completed", d);
    if (!ev) {
      this.pending.delete(d.requestId);
      return;
    }
    p.completed = ev;
    this.opts.onEvent(ev);
    if (p.inspecting) this.tryEmitInspection(d.requestId, p);
    else this.pending.delete(d.requestId);
  }

  private onError(d: RequestDetailsLike): void {
    const p = this.pending.get(d.requestId);
    if (!p) return;
    const ev = buildEvent(this.opts.browserName, "error", d);
    if (ev) this.opts.onEvent(ev);
    this.pending.delete(d.requestId);
  }

  /** Emits the inspection event once both completion metadata and the stream result exist. */
  private tryEmitInspection(requestId: string, p: Pending): void {
    if (!p.inspection || !p.completed) return;
    const base: NormalizedEvent = { ...p.completed };
    if (p.contentType && !p.inspection.result.inspection.contentType) {
      p.inspection.result.inspection.contentType = p.contentType;
    }
    const ev = buildInspectionEvent(base, p.inspection.result, p.inspection.at);
    this.opts.onEvent(ev);
    this.pending.delete(requestId);
  }

  private sweep(now: number, force = false): void {
    for (const [id, p] of this.pending) {
      if (force || now - p.createdAt > PENDING_TTL_MS) {
        if (p.inspecting && !p.inspection) {
          // Stream never finished within TTL: record the limitation and drop. The filter was
          // released by its own onstop/onerror handlers; we only forget our bookkeeping.
          const lim: ObservationLimitation[] = [
            ...p.started.observationLimitations,
            "sensor_restarted_during_request",
          ];
          this.opts.onLog?.(
            "warn",
            `inspection for ${id} did not complete within TTL (${lim.join(",")})`,
          );
        }
        this.pending.delete(id);
      }
      if (force && this.pending.size < PENDING_MAX / 2) break;
    }
  }
}

/** Synthetic navigation event for frame lifecycle (used by tests and the optional navigation sensor). */
export function frameNavigatedEvent(
  browserName: BrowserName,
  tabId: number,
  frameId: number,
  url: string,
): NormalizedEvent | null {
  const d: RequestDetailsLike = {
    requestId: `nav-${newId()}`,
    url,
    type: frameId === 0 ? "main_frame" : "sub_frame",
    tabId,
    frameId,
    parentFrameId: frameId === 0 ? -1 : 0,
    timeStamp: Date.now(),
  };
  const ev = buildEvent(browserName, "started", d);
  if (!ev) return null;
  ev.sensor = "navigation";
  ev.eventType = "frame_navigated";
  return ev;
}
