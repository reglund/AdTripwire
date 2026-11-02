/**
 * AdTripwire background (Firefox MV3 event page).
 *
 * Wiring: WebRequestSensor → DetectionEngine → LocalStore, with the UI talking to this
 * script through a strictly validated message protocol. Nothing here blocks, cancels,
 * redirects or modifies any request. No network calls are made by the extension itself.
 */
import type {
  Detection,
  IndicatorSet,
  MonitoringSettings,
  MonitoringStatus,
  NormalizedEvent,
  SensorCapabilities,
  SensorCapability,
  UiRequest,
} from "@adtripwire/shared";
import {
  BUNDLED_INDICATOR_SETS,
  IndicatorMatcher,
  validateIndicatorSet,
} from "@adtripwire/indicators";
import {
  DetectionEngine,
  MemoryExposureStore,
  analyzeJavaScript,
  type EngineSnapshot,
} from "@adtripwire/detection-engine";
import { buildEvidenceExport, serializeExport } from "@adtripwire/privacy";
import {
  addIndicatorPatterns,
  buildInspectionMatchPatterns,
  isNoasPath,
  type SensorOptions,
} from "@adtripwire/sensor-firefox";
import { LocalStore, EMPTY_METRICS, type Metrics } from "./storage.js";
import { fail, isPageSensorSender, isTrustedSender, ok, parseUiRequest } from "./messages.js";
import { buildPageSignalEvent, pageSignalAllowed } from "./page-signals.js";
import { hostnameOf } from "@adtripwire/privacy";
import syntheticSet from "../../../../tests/fixtures/indicators/synthetic.json";

/** Browser-specific pieces the shared background needs. */
export interface SensorAdapter {
  browserName: "firefox" | "chromium";
  detectCapabilities(): Promise<SensorCapabilities>;
  createSensor(opts: SensorOptions): {
    register(): void;
    dispose(): void;
    readonly stats: { pending: number; activeFilters: number; skippedForBudget: number };
  };
}

const SESSION_KEY_ENGINE = "engineSnapshot";
const PAGE_SENSOR_ID = "adtripwire-page-sensor";
const ALARM_RETENTION = "adtripwire-retention";
const log = (level: "info" | "warn" | "error", msg: string) => {
  const line = `[AdTripwire] ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};

class Background {
  private store = new LocalStore();
  private readonly matcher: IndicatorMatcher;
  private readonly sets: IndicatorSet[] = [];
  private engine: DetectionEngine | undefined;
  private capabilities: SensorCapabilities;
  private readonly sensor: ReturnType<SensorAdapter["createSensor"]>;
  private exposure = new MemoryExposureStore();
  private metrics: Metrics = { ...EMPTY_METRICS };
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly ready: Promise<void>;
  private isReady = false;
  private deleting = false;
  /** Events observed before async init finished; drained into the engine on ready. */
  private readonly preReady: NormalizedEvent[] = [];
  private static readonly PRE_READY_MAX = 500;

  constructor(private readonly adapter: SensorAdapter) {
    this.capabilities = {
      browser: adapter.browserName,
      capabilities: [],
      notes: ["capabilities not yet detected"],
    };
    // Everything needed to register listeners is synchronous: indicator sets are bundled.
    this.sets = [...BUNDLED_INDICATOR_SETS];
    if (__ADTRIPWIRE_DEV__) {
      const v = validateIndicatorSet(syntheticSet);
      if (v.ok) {
        this.sets.push(v.set);
        log("warn", "DEV build: synthetic indicator set loaded (reserved .test names).");
      } else log("error", `synthetic set invalid: ${v.errors.join("; ")}`);
    }
    this.matcher = new IndicatorMatcher(this.sets);

    const patterns = buildInspectionMatchPatterns(this.sets);
    if (__ADTRIPWIRE_DEV__) {
      const extra = new Set<string>(patterns);
      for (const s of this.sets)
        if (s.meta.synthetic) for (const r of s.indicators) addIndicatorPatterns(extra, r);
      patterns.splice(0, patterns.length, ...extra);
    }

    // Event pages: listeners must be registered synchronously at top level so Firefox can
    // wake the page for them. Callbacks consult current state lazily.
    this.sensor = this.adapter.createSensor({
      browserName: this.adapter.browserName,
      inspectionMatchPatterns: patterns,
      shouldObserve: (ev) => this.shouldObserve(ev),
      shouldInspect: (ev) =>
        this.isReady &&
        this.store.getSettings().monitoring.responseInspectionEnabled &&
        (this.matcher.match(ev.destination.hostname, ev.destination.pathPattern).length > 0 ||
          isNoasPath(ev.destination.pathPattern)),
      analyzer: (text) => analyzeJavaScript(text),
      maxInspectBytes: () => this.store.getSettings().monitoring.responseInspectionMaxBytes,
      excludeIncognito: () => this.store.getSettings().monitoring.excludeIncognito,
      enabled: () => this.store.getSettings().monitoring.enabled && !this.deleting,
      onEvent: (ev) => this.onEvent(ev),
      onLog: log,
      onMetrics: (m) => {
        this.metrics.inspections++;
        this.metrics.inspectedBytes += m.bytes;
        this.metrics.passThroughMsTotal += m.passThroughMs;
        this.metrics.analysisMsTotal += m.analysisMs;
      },
    });
    this.sensor.register();
    browser.alarms.onAlarm.addListener((a) => {
      if (a.name === ALARM_RETENTION) void this.ready.then(() => this.runRetention());
    });

    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.store.load();
    if (__ADTRIPWIRE_DEV__ && !(await browser.storage.local.get("settings")).settings) {
      // DEV builds (never shipped) enable the page sensor so the browser-level test covers it.
      await this.store.updateSettings({ pageSensorEnabled: true });
    }
    this.metrics = await this.store.getMetrics();
    this.capabilities = await this.adapter.detectCapabilities();
    await this.applyPageSensorSetting();

    let exposure = new MemoryExposureStore();
    const expSnap = await this.store.getExposureSnapshot();
    if (expSnap) {
      try {
        exposure = MemoryExposureStore.fromJSON(expSnap);
      } catch (e) {
        log("warn", `exposure snapshot ignored: ${String(e)}`);
      }
    }
    this.exposure = exposure;

    const engineOpts = this.engineOptions(this.store.getSettings().monitoring);
    let restored = false;
    try {
      const s = await browser.storage.session.get(SESSION_KEY_ENGINE);
      const snap = s[SESSION_KEY_ENGINE] as EngineSnapshot | undefined;
      if (snap) {
        this.engine = DetectionEngine.restore(snap, engineOpts);
        restored = true;
      }
    } catch (e) {
      log("info", `no engine snapshot restored: ${String(e)}`);
    }
    if (!restored) this.engine = new DetectionEngine(engineOpts);

    browser.alarms.create(ALARM_RETENTION, { periodInMinutes: 60 });
    this.runRetention();
    // Periodic aggregate line (counts only, no URLs) so evaluation runs can confirm the sensor
    // is seeing traffic even when nothing is detected.
    setInterval(() => {
      const m = this.metrics;
      log(
        "info",
        `stats: observed=${m.eventsObserved} ingested=${m.eventsIngested} inspections=${m.inspections} detections=${this.store.listDetections().length}`,
      );
    }, 60_000);
    this.isReady = true;
    const queued = this.preReady.splice(0);
    for (const ev of queued) this.onEvent(ev);
    log(
      "info",
      `ready: ${this.matcher.size} indicators, ruleset ${this.eng.rulesetVersion}, caps=${this.capabilities.capabilities.join(",")}${queued.length ? `, replayed ${queued.length} early events` : ""}`,
    );
  }

  private pageSensorChain: Promise<void> = Promise.resolve();

  /**
   * Registers or unregisters the opt-in page sensor content script and updates capabilities.
   * Calls are serialised and the setting is re-read after each await so a rapid
   * enable→disable sequence can never leave the script registered while the setting is off.
   */
  private applyPageSensorSetting(): Promise<void> {
    this.pageSensorChain = this.pageSensorChain.then(() => this.applyPageSensorSettingNow());
    return this.pageSensorChain;
  }

  private async applyPageSensorSettingNow(): Promise<void> {
    const enabled = this.store.getSettings().monitoring.pageSensorEnabled;
    const caps = new Set<SensorCapability>(
      this.capabilities.capabilities.filter((c) => c !== "page_signals"),
    );
    const notes = this.capabilities.notes.filter((n) => !n.startsWith("Page sensor"));
    try {
      const existing = await browser.scripting.getRegisteredContentScripts({
        ids: [PAGE_SENSOR_ID],
      });
      // Re-read after the await: the user may have toggled again meanwhile.
      if (this.store.getSettings().monitoring.pageSensorEnabled !== enabled) return;
      if (enabled) {
        if (existing.length === 0) {
          try {
            await browser.scripting.registerContentScripts([
              {
                id: PAGE_SENSOR_ID,
                js: ["page-sensor.js"],
                matches: ["http://*/*", "https://*/*"],
                allFrames: true,
                runAt: "document_start",
                persistAcrossSessions: false,
              },
            ]);
          } catch (e) {
            // A duplicate-id error means a concurrent call already registered it.
            if (!/already|duplicate/i.test(String(e))) throw e;
          }
          if (!this.store.getSettings().monitoring.pageSensorEnabled) {
            await browser.scripting.unregisterContentScripts({ ids: [PAGE_SENSOR_ID] });
            return;
          }
        }
        caps.add("page_signals");
        log("info", "page sensor registered (sub-frames only)");
        notes.push(
          "Page sensor enabled by the user: an isolated content script in sub-frames reports structural signals (hidden iframe insertion, late third-party inserts, SDK messages). No page text or cookies.",
        );
      } else {
        if (existing.length > 0)
          await browser.scripting.unregisterContentScripts({ ids: [PAGE_SENSOR_ID] });
        notes.push(
          "Page sensor disabled (default): in-page insertions and messages are not observed.",
        );
      }
    } catch (e) {
      log("warn", `page sensor registration failed: ${String(e)}`);
      notes.push("Page sensor unavailable: content-script registration failed.");
    }
    this.capabilities = { ...this.capabilities, capabilities: Array.from(caps), notes };
    if (this.engine) {
      this.engine = DetectionEngine.restore(
        this.engine.snapshot(),
        this.engineOptions(this.store.getSettings().monitoring),
      );
    }
  }

  /** Entry point for validated page-sensor messages. */
  handlePageSignal(raw: unknown, sender: browser.runtime.MessageSender): void {
    if (!this.store.getSettings().monitoring.pageSensorEnabled) return;
    const tabId = sender.tab?.id ?? -1;
    const frameId = sender.frameId ?? -1;
    const now = Date.now();
    if (!pageSignalAllowed(tabId, now, frameId)) return;
    if (sender.tab?.incognito && this.store.getSettings().monitoring.excludeIncognito) return;
    void this.frameAncestry(tabId, frameId).then((ancestry) => {
      const ev = buildPageSignalEvent(
        raw,
        { tabId, frameId, ...(sender.url ? { frameUrl: sender.url } : {}) },
        now,
        ancestry,
      );
      if (ev) {
        if (__ADTRIPWIRE_DEV__)
          log("info", `page signal ${ev.pageSignal?.kind ?? "?"} (frame ${frameId})`);
        this.onEvent(ev);
      }
    });
  }

  /**
   * Frame ancestry from the browser (webNavigation), never from the page. Returns undefined
   * when unavailable so the event carries the frame_ancestry_unavailable limitation.
   */
  private async frameAncestry(
    tabId: number,
    frameId: number,
  ): Promise<{ frameIds: number[]; hostnames: string[]; truncated: boolean } | undefined> {
    if (tabId < 0 || frameId <= 0) return undefined;
    try {
      const frames = await browser.webNavigation.getAllFrames({ tabId });
      if (!frames) return undefined;
      const byId = new Map(frames.map((f) => [f.frameId, f]));
      const frameIds: number[] = [];
      const hostnames: string[] = [];
      const seen = new Set<number>([frameId]);
      let current = byId.get(frameId);
      let truncated = false;
      while (current && current.parentFrameId >= 0) {
        if (seen.has(current.parentFrameId) || frameIds.length >= 16) {
          truncated = true;
          break;
        }
        const parent = byId.get(current.parentFrameId);
        if (!parent) return undefined;
        seen.add(parent.frameId);
        frameIds.push(parent.frameId);
        hostnames.push(hostnameOf(parent.url) ?? "unknown.invalid");
        current = parent;
      }
      return { frameIds, hostnames, truncated };
    } catch {
      return undefined;
    }
  }

  /**
   * Privacy policy for what enters the correlation window at all: third-party or framed
   * requests, indicator matches, and NOAS-pattern paths. First-party, top-level browsing
   * is never observed (that would be a browsing history).
   */
  private shouldObserve(ev: NormalizedEvent): boolean {
    this.metrics.eventsObserved++;
    if (ev.eventType === "page_signal") return true;
    if (ev.resourceType === "main_frame") return false;
    if (ev.frameContext.thirdParty === true) return true;
    if (ev.frameContext.depth > 0) return true;
    if (isNoasPath(ev.destination.pathPattern)) return true;
    return this.matcher.match(ev.destination.hostname, ev.destination.pathPattern).length > 0;
  }

  private onEvent(ev: NormalizedEvent): void {
    if (this.deleting) return;
    if (!this.isReady || !this.engine) {
      if (this.preReady.length < Background.PRE_READY_MAX) this.preReady.push(ev);
      return;
    }
    const engine = this.engine;
    const t0 = performance.now();
    try {
      const { detections, updated } = engine.ingest(ev);
      this.metrics.eventsIngested++;
      for (const d of detections) {
        const supporting = this.eventsById(d.eventIds);
        this.store.addDetection(d, supporting);
        log("info", `detection ${d.ruleId} [${d.severity}] ${d.summary}`);
      }
      for (const d of updated) {
        const prev = this.store.getDetection(d.detectionId);
        this.store.updateDetection(d);
        for (const e of this.eventsById(d.eventIds)) this.store.addSupportingEvent(e);
        if (prev && prev.severity !== d.severity) {
          log("info", `escalated ${d.ruleId} ${prev.severity} → ${d.severity}: ${d.summary}`);
        }
      }
      if (detections.length || updated.length)
        void this.store.setExposureSnapshot(this.exposure.toJSON());
      this.scheduleSnapshot();
    } catch (e) {
      log("error", `ingest failed: ${String(e)}`);
    } finally {
      this.metrics.ingestMsTotal += performance.now() - t0;
    }
  }

  private eventsById(ids: string[]): NormalizedEvent[] {
    const want = new Set(ids);
    return this.engine ? this.engine.window.recent().filter((e) => want.has(e.eventId)) : [];
  }

  /** The engine after `ready`; message handlers await `ready` first. */
  private get eng(): DetectionEngine {
    if (!this.engine) throw new Error("engine not initialised");
    return this.engine;
  }

  private engineOptions(settings: MonitoringSettings) {
    return {
      matcher: this.matcher,
      capabilities: this.capabilities,
      settings,
      exposure: this.exposure,
      now: () => Date.now(),
    };
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      if (!this.engine) return;
      this.engine.pruneWindow();
      browser.storage.session
        .set({ [SESSION_KEY_ENGINE]: this.engine.snapshot() })
        .catch((e) => log("warn", `snapshot: ${String(e)}`));
      void this.store.setMetrics(this.metrics);
    }, 2000);
  }

  private runRetention(): void {
    const removed = this.store.applyRetention(Date.now(), this.store.getSettings().retention);
    if (removed.removedDetections || removed.removedEvents)
      log(
        "info",
        `retention removed ${removed.removedDetections} detections, ${removed.removedEvents} events`,
      );
  }

  private async status(): Promise<MonitoringStatus> {
    const dets = this.store.listDetections();
    const hostPermissionGranted = await browser.permissions.contains({ origins: ["<all_urls>"] });
    const counts = {
      knownIocObservations: dets.filter((d) => d.category === "known_infrastructure").length,
      suspiciousPatterns: dets.filter(
        (d) =>
          d.category !== "known_infrastructure" &&
          (d.severity === "suspicious" || d.severity === "elevated"),
      ).length,
      highPriority: dets.filter((d) => d.severity === "high_priority").length,
      detectionsTotal: dets.length,
      eventsStored: this.store.allEvents().length,
    };
    const rank: Record<Detection["severity"], number> = {
      informational: 0,
      suspicious: 1,
      elevated: 2,
      high_priority: 3,
    };
    const significant = dets
      .filter((d) => rank[d.severity] >= 1)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    const s: MonitoringStatus = {
      monitoring: this.store.getSettings().monitoring.enabled && hostPermissionGranted,
      hostPermissionGranted,
      capabilities: this.capabilities,
      counts,
      indicatorSets: this.sets.map((x) => x.meta),
      rulesetVersion: this.eng.rulesetVersion,
      productVersion: __ADTRIPWIRE_VERSION__,
    };
    const m = this.metrics;
    const stats = this.sensor.stats;
    s.metrics = {
      eventsObserved: m.eventsObserved,
      eventsIngested: m.eventsIngested,
      inspections: m.inspections,
      inspectedBytes: m.inspectedBytes,
      passThroughMsMean: m.inspections ? m.passThroughMsTotal / m.inspections : 0,
      analysisMsMean: m.inspections ? m.analysisMsTotal / m.inspections : 0,
      ingestMsMean: m.eventsIngested ? m.ingestMsTotal / m.eventsIngested : 0,
      inspectionsSkippedForBudget: stats.skippedForBudget,
      since: m.startedAt,
    };
    if (significant) {
      s.lastSignificant = {
        detectionId: significant.detectionId,
        timestamp: significant.timestamp,
        severity: significant.severity,
        summary: significant.summary,
      };
    }
    return s;
  }

  async handle(req: UiRequest): Promise<unknown> {
    await this.ready;
    switch (req.type) {
      case "get_status":
        return this.status();
      case "list_detections": {
        const f = req.filter ?? {};
        let list = this.store.listDetections();
        if (f.categories?.length) list = list.filter((d) => f.categories!.includes(d.category));
        if (f.severities?.length) list = list.filter((d) => f.severities!.includes(d.severity));
        if (f.confidences?.length) list = list.filter((d) => f.confidences!.includes(d.confidence));
        if (f.since !== undefined) list = list.filter((d) => d.timestamp >= f.since!);
        list = [...list].sort((a, b) => b.timestamp - a.timestamp);
        return list.slice(0, f.limit ?? 500);
      }
      case "get_detection":
        return this.store.getDetection(req.detectionId) ?? null;
      case "get_events":
        return this.store.getEvents(req.eventIds);
      case "get_settings":
        return this.store.getSettings();
      case "update_settings": {
        const s = await this.store.updateSettings(req.patch);
        // Settings affect capability gating and window size: rebuild from the current snapshot.
        this.engine = DetectionEngine.restore(
          this.eng.snapshot(),
          this.engineOptions(s.monitoring),
        );
        if ("pageSensorEnabled" in req.patch) await this.applyPageSensorSetting();
        return s;
      }
      case "export_evidence": {
        let detections = this.store.listDetections();
        if (req.detectionIds)
          detections = detections.filter((d) => req.detectionIds!.includes(d.detectionId));
        const ids = new Set<string>();
        for (const d of detections) for (const id of d.eventIds) ids.add(id);
        const events = this.store.getEvents(Array.from(ids));
        const exp = buildEvidenceExport({
          productVersion: __ADTRIPWIRE_VERSION__,
          browser: this.capabilities,
          rulesetVersion: this.eng.rulesetVersion,
          indicatorSets: this.sets.map((x) => x.meta),
          detections,
          events,
          profile: req.profile,
        });
        return {
          filename: `adtripwire-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
          json: serializeExport(exp),
        };
      }
      case "delete_all_data": {
        // Stop ingesting first so nothing lands in the store between clear and swap.
        this.deleting = true;
        try {
          this.exposure = new MemoryExposureStore();
          this.engine = new DetectionEngine(
            this.engineOptions(this.store.getSettings().monitoring),
          );
          if (this.snapshotTimer) {
            clearTimeout(this.snapshotTimer);
            this.snapshotTimer = undefined;
          }
          await this.store.deleteAll();
          this.metrics = { ...EMPTY_METRICS, startedAt: Date.now() };
        } finally {
          this.deleting = false;
        }
        return { deleted: true };
      }
      case "request_host_permission": {
        const granted = await browser.permissions.request({ origins: ["<all_urls>"] });
        return { granted };
      }
      case "list_rules":
        return this.eng.listRules();
    }
  }
}

export function startBackground(adapter: SensorAdapter): void {
  const bg = new Background(adapter);
  const baseUrl = browser.runtime.getURL("");

  // sendResponse + `return true` works on both Firefox and Chromium (Chromium does not
  // accept a returned Promise from onMessage listeners).
  browser.runtime.onMessage.addListener(
    (raw: unknown, sender, sendResponse: (r: unknown) => void): true | undefined => {
      if (raw && typeof raw === "object" && (raw as { type?: unknown }).type === "page_signal") {
        if (isPageSensorSender(sender)) bg.handlePageSignal(raw, sender);
        return undefined;
      }
      if (!isTrustedSender(sender, baseUrl)) {
        sendResponse(fail("untrusted sender"));
        return undefined;
      }
      const req = parseUiRequest(raw);
      if (!req) {
        sendResponse(fail("invalid request"));
        return undefined;
      }
      bg.handle(req)
        .then((data) => sendResponse(ok(data)))
        .catch((e: unknown) =>
          sendResponse(fail(e instanceof Error ? e.message : "internal error")),
        );
      return true;
    },
  );

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install")
      log("info", "installed; monitoring starts once host permission is present");
    if (__ADTRIPWIRE_DEV__) {
      // DEV builds open the dashboard so the browser-level test can confirm the UI renders.
      setTimeout(() => {
        browser.tabs
          .create({ url: browser.runtime.getURL("dashboard.html#detections"), active: false })
          .catch((e) => log("warn", `could not open dashboard: ${String(e)}`));
      }, 15_000);
    }
  });
}
