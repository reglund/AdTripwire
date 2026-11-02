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
  WebRequestSensor,
  addIndicatorPatterns,
  buildInspectionMatchPatterns,
  detectCapabilities,
  isNoasPath,
} from "@adtripwire/sensor-firefox";
import { LocalStore, EMPTY_METRICS, type Metrics } from "./storage.js";
import { fail, isTrustedSender, ok, parseUiRequest } from "./messages.js";
import syntheticSet from "../../../../tests/fixtures/indicators/synthetic.json";

const SESSION_KEY_ENGINE = "engineSnapshot";
const ALARM_RETENTION = "adtripwire-retention";
const log = (level: "info" | "warn" | "error", msg: string) => {
  const line = `[AdTripwire] ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};

class Background {
  private store = new LocalStore();
  private matcher!: IndicatorMatcher;
  private sets: IndicatorSet[] = [];
  private engine!: DetectionEngine;
  private capabilities!: SensorCapabilities;
  private sensor: WebRequestSensor | undefined;
  private exposure = new MemoryExposureStore();
  private metrics: Metrics = { ...EMPTY_METRICS };
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.store.load();
    this.metrics = await this.store.getMetrics();
    this.capabilities = await detectCapabilities();

    this.sets = [...BUNDLED_INDICATOR_SETS];
    if (__ADTRIPWIRE_DEV__) {
      const v = validateIndicatorSet(syntheticSet);
      if (v.ok) {
        this.sets.push(v.set);
        log("warn", "DEV build: synthetic indicator set loaded (reserved .test names).");
      } else log("error", `synthetic set invalid: ${v.errors.join("; ")}`);
    }
    this.matcher = new IndicatorMatcher(this.sets);

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

    const patterns = buildInspectionMatchPatterns(this.sets);
    if (__ADTRIPWIRE_DEV__) {
      const extra = new Set<string>(patterns);
      for (const s of this.sets)
        if (s.meta.synthetic) for (const r of s.indicators) addIndicatorPatterns(extra, r);
      patterns.splice(0, patterns.length, ...extra);
    }

    this.sensor = new WebRequestSensor({
      browserName: this.capabilities.browser,
      inspectionMatchPatterns: patterns,
      shouldObserve: (ev) => this.shouldObserve(ev),
      shouldInspect: (ev) =>
        this.store.getSettings().monitoring.responseInspectionEnabled &&
        (this.matcher.match(ev.destination.hostname, ev.destination.pathPattern).length > 0 ||
          isNoasPath(ev.destination.pathPattern)),
      analyzer: (text) => analyzeJavaScript(text),
      maxInspectBytes: () => this.store.getSettings().monitoring.responseInspectionMaxBytes,
      excludeIncognito: () => this.store.getSettings().monitoring.excludeIncognito,
      enabled: () => this.store.getSettings().monitoring.enabled,
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

    browser.alarms.create(ALARM_RETENTION, { periodInMinutes: 60 });
    browser.alarms.onAlarm.addListener((a) => {
      if (a.name === ALARM_RETENTION) this.runRetention();
    });
    this.runRetention();
    log(
      "info",
      `ready: ${this.matcher.size} indicators, ruleset ${this.engine.rulesetVersion}, caps=${this.capabilities.capabilities.join(",")}`,
    );
  }

  /**
   * Privacy policy for what enters the correlation window at all: third-party or framed
   * requests, indicator matches, and NOAS-pattern paths. First-party, top-level browsing
   * is never observed (that would be a browsing history).
   */
  private shouldObserve(ev: NormalizedEvent): boolean {
    this.metrics.eventsObserved++;
    if (ev.resourceType === "main_frame") return false;
    if (ev.frameContext.thirdParty === true) return true;
    if (ev.frameContext.depth > 0) return true;
    if (isNoasPath(ev.destination.pathPattern)) return true;
    return this.matcher.match(ev.destination.hostname, ev.destination.pathPattern).length > 0;
  }

  private onEvent(ev: NormalizedEvent): void {
    const t0 = performance.now();
    try {
      const { detections, updated } = this.engine.ingest(ev);
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
    return this.engine.window.recent().filter((e) => want.has(e.eventId));
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
      rulesetVersion: this.engine.rulesetVersion,
      productVersion: __ADTRIPWIRE_VERSION__,
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
          this.engine.snapshot(),
          this.engineOptions(s.monitoring),
        );
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
          rulesetVersion: this.engine.rulesetVersion,
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
        await this.store.deleteAll();
        this.exposure = new MemoryExposureStore();
        this.engine = new DetectionEngine(this.engineOptions(this.store.getSettings().monitoring));
        this.metrics = { ...EMPTY_METRICS, startedAt: Date.now() };
        return { deleted: true };
      }
      case "request_host_permission": {
        const granted = await browser.permissions.request({ origins: ["<all_urls>"] });
        return { granted };
      }
      case "list_rules":
        return this.engine.listRules();
    }
  }
}

const bg = new Background();
const baseUrl = browser.runtime.getURL("");

browser.runtime.onMessage.addListener((raw: unknown, sender) => {
  if (!isTrustedSender(sender, baseUrl)) return Promise.resolve(fail("untrusted sender"));
  const req = parseUiRequest(raw);
  if (!req) return Promise.resolve(fail("invalid request"));
  return bg
    .handle(req)
    .then(ok)
    .catch((e: unknown) => fail(e instanceof Error ? e.message : "internal error"));
});

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
