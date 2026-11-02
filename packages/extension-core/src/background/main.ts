/**
 * AdTripwire background (Firefox MV3 event page).
 *
 * Wiring: WebRequestSensor → DetectionEngine → LocalStore, with the UI talking to this
 * script through a strictly validated message protocol. Nothing here blocks, cancels,
 * redirects or modifies any request. No network calls are made by the extension itself.
 */
import type {
  AssistPackage,
  ClusterDetail,
  Detection,
  DetectionCluster,
  ExportFile,
  ImportResult,
  IndicatorSet,
  SignedBundlePreview,
  TimelineEntry,
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
  diffIndicatorSets,
  validateIndicatorSet,
  verifySignedBundle,
  type SignedBundle,
} from "@adtripwire/indicators";
import {
  DetectionEngine,
  MemoryExposureStore,
  analyzeJavaScript,
  type EngineSnapshot,
} from "@adtripwire/detection-engine";
import { buildEvidenceExport, serializeExport } from "@adtripwire/privacy";
import { stixToIndicatorSet } from "@adtripwire/interop";
import { exportResearch } from "./research-export.js";
import {
  buildAssistContext,
  clusterDetections,
  clusterDomain,
  renderPrompt,
  suggestActions,
  summarizeTimeline,
} from "@adtripwire/correlation";
import {
  MAX_IMPORTED_INDICATORS_TOTAL,
  applyBundledPrecedence,
  summariseDrops,
} from "./import-policy.js";
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
    /** Firefox: swap blocking-listener match patterns after an indicator-set change. */
    updateInspectionPatterns?(patterns: string[]): void;
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
  private matcher: IndicatorMatcher;
  /** Bundled (+ synthetic in DEV) sets; imported sets live in the store. */
  private readonly sets: IndicatorSet[] = [];
  private engine: DetectionEngine | undefined;
  private capabilities: SensorCapabilities;
  /** Registrable domains seen in third-party requests; a bounded set, counted for evaluation runs. */
  private thirdPartyDomains = new Set<string>();
  private static readonly THIRD_PARTY_DOMAINS_MAX = 20_000;
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
    await this.restoreSignedBundle();
    this.rebuildMatcher();
    if (__ADTRIPWIRE_DEV__ && !(await browser.storage.local.get("settings")).settings) {
      // DEV builds (never shipped) enable the page sensor so the browser-level test covers it.
      await this.store.updateSettings({ pageSensorEnabled: true });
    }
    this.metrics = await this.store.getMetrics();
    this.capabilities = await this.adapter.detectCapabilities();
    await this.applyPageSensorSetting();

    if (__ADTRIPWIRE_DEV__) {
      // DEV-only module (dropped from production bundles together with the bundle payload).
      void import("./dev-selftest.js").then(
        (m) => m.runSignedBundleSelfTest(this.updatableSetId(), log),
        (e: unknown) => log("warn", `dev self-test module could not load: ${String(e)}`),
      );
    }

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
        `stats: observed=${m.eventsObserved} ingested=${m.eventsIngested} inspections=${m.inspections} detections=${this.store.listDetections().length} thirdPartyDomains=${this.thirdPartyDomains.size}`,
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

  /** Bundled sets plus enabled imported sets. */
  /** A verified signed bundle (if any) replacing the built-in set with the same id. */
  private signedBundle: SignedBundle | null = null;

  /** Curated sets: built-in, with the signed bundle substituted for the set it updates. */
  private curatedSets(): IndicatorSet[] {
    const sb = this.signedBundle;
    return this.sets.map((s) => (sb && s.meta.id === sb.payload.meta.id ? sb.payload : s));
  }

  private builtInVersionOf(setId: string): string | undefined {
    return this.sets.find((s) => s.meta.id === setId)?.meta.version;
  }

  private activeSets(): IndicatorSet[] {
    return [
      ...this.curatedSets(),
      ...this.store
        .listImportedSets()
        .filter((r) => r.enabled)
        .map((r) => r.set),
    ];
  }

  /** Rebuilds the matcher and the sensor's inspection patterns after an indicator-set change. */
  private rebuildMatcher(): void {
    const active = this.activeSets();
    this.matcher = new IndicatorMatcher(active);
    const patterns = buildInspectionMatchPatterns(active.filter((s) => !s.meta.synthetic));
    const extra = new Set<string>(patterns);
    if (__ADTRIPWIRE_DEV__) {
      for (const set of active)
        if (set.meta.synthetic) for (const r of set.indicators) addIndicatorPatterns(extra, r);
    }
    this.sensor.updateInspectionPatterns?.(Array.from(extra));
    if (this.engine) {
      this.engine = DetectionEngine.restore(
        this.engine.snapshot(),
        this.engineOptions(this.store.getSettings().monitoring),
      );
    }
  }

  private withNote(d: Detection): Detection & { note?: string } {
    const n = this.store.getNote(d.detectionId);
    return n ? { ...d, note: n.note } : d;
  }

  private timeline(opts: { tabId?: number; since?: number; limit?: number }): TimelineEntry[] {
    const since = opts.since ?? 0;
    const entries: TimelineEntry[] = [];
    for (const d of this.store.listDetections()) {
      if (d.timestamp < since) continue;
      if (opts.tabId !== undefined && d.tabId !== opts.tabId) continue;
      const e: TimelineEntry = {
        timestamp: d.timestamp,
        kind: "detection",
        detectionId: d.detectionId,
        severity: d.severity,
        ruleId: d.ruleId,
        summary: d.summary,
      };
      if (d.subjectHostnames[0]) e.hostname = d.subjectHostnames[0];
      if (d.tabId !== undefined) e.tabId = d.tabId;
      entries.push(e);
    }
    for (const ev of this.store.allEvents()) {
      if (ev.timestamp < since) continue;
      if (opts.tabId !== undefined && ev.tabId !== opts.tabId) continue;
      const e: TimelineEntry = {
        timestamp: ev.timestamp,
        kind: "event",
        eventId: ev.eventId,
        summary:
          `${ev.eventType} ${ev.resourceType ?? ""} ${ev.destination.hostname}${ev.destination.pathPattern}`.trim(),
        hostname: ev.destination.hostname,
        frameId: ev.frameContext.frameId,
      };
      if (ev.tabId !== undefined) e.tabId = ev.tabId;
      entries.push(e);
    }
    entries.sort((a, b) => a.timestamp - b.timestamp);
    const limit = opts.limit ?? 500;
    return entries.length > limit ? entries.slice(entries.length - limit) : entries;
  }

  // ── Phase 5: deterministic correlation ─────────────────────────────────────────────────

  private clusters(): DetectionCluster[] {
    return clusterDetections(this.store.listDetections(), {
      windowMs: this.store.getSettings().monitoring.correlationWindowMs,
      maxDetections: this.store.getSettings().retention.maxDetections,
    });
  }

  private clusterDetail(clusterId: string): ClusterDetail | null {
    const cluster = this.clusters().find((c) => c.clusterId === clusterId);
    if (!cluster) return null;
    const detections = cluster.detectionIds
      .map((id) => this.store.getDetection(id))
      .filter((d): d is Detection => d !== undefined);
    const events = this.store.getEvents(detections.flatMap((d) => d.eventIds));
    return {
      cluster,
      detections: detections.map((d) => this.withNote(d)),
      timeline: summarizeTimeline(detections, events),
      actions: suggestActions(cluster, detections, this.capabilities),
    };
  }

  /**
   * Builds the complete package a local model would receive. Analyst notes are never part
   * of it; the UI shows the exact text before anything is sent.
   */
  private assistPackage(req: Extract<UiRequest, { type: "get_assist_package" }>): AssistPackage {
    const language = req.language ?? this.store.getSettings().assist.language;
    let detections: Detection[];
    let cluster: DetectionCluster | undefined;
    if (req.clusterId !== undefined) {
      cluster = this.clusters().find((c) => c.clusterId === req.clusterId);
      if (!cluster) throw new Error("unknown cluster");
      detections = cluster.detectionIds
        .map((id) => this.store.getDetection(id))
        .filter((d): d is Detection => d !== undefined);
    } else {
      const d =
        req.detectionId !== undefined ? this.store.getDetection(req.detectionId) : undefined;
      if (!d) throw new Error("unknown detection");
      detections = [d];
      cluster = clusterDetections([d], { windowMs: 0 })[0];
    }
    if (!cluster) throw new Error("no cluster");
    const events = this.store.getEvents(detections.flatMap((d) => d.eventIds));
    const timeline = summarizeTimeline(detections, events);
    const actions = suggestActions(cluster, detections, this.capabilities);
    const input = {
      language,
      productVersion: __ADTRIPWIRE_VERSION__,
      capabilities: this.capabilities,
      detections,
      events,
      timeline,
      actions,
      ...(req.clusterId !== undefined ? { cluster } : {}),
    };
    return renderPrompt(buildAssistContext(input));
  }

  // ── Phase 6: signed indicator bundles (offline) ───────────────────────────────────────

  /** The one built-in curated set a signed bundle may replace (first non-synthetic set). */
  private updatableSetId(): string {
    return this.sets.find((s) => !s.meta.synthetic)?.meta.id ?? "";
  }

  private async verifyBundleText(
    text: string,
  ): Promise<{ ok: true; bundle: SignedBundle; keyId: string } | { ok: false; errors: string[] }> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, errors: ["not valid JSON"] };
    }
    const setId = this.updatableSetId();
    const active = this.curatedSets().find((s) => s.meta.id === setId);
    const opts = {
      expectedSetId: setId,
      ...(active ? { activeVersion: active.meta.version } : {}),
    };
    const r = await verifySignedBundle(parsed, opts);
    return r.ok ? { ok: true, bundle: r.bundle, keyId: r.key.keyId } : r;
  }

  private async previewSignedBundle(text: string): Promise<SignedBundlePreview> {
    const r = await this.verifyBundleText(text);
    if (!r.ok) return { ok: false, errors: r.errors };
    const current = this.curatedSets().find((s) => s.meta.id === r.bundle.payload.meta.id);
    const preview: SignedBundlePreview = {
      ok: true,
      errors: [],
      meta: r.bundle.meta,
      setId: r.bundle.payload.meta.id,
      indicatorCount: r.bundle.payload.indicators.length,
    };
    if (current) {
      preview.activeVersion = current.meta.version;
      const d = diffIndicatorSets(current, r.bundle.payload);
      const lines = [
        ...d.added.map(
          (x) => `+ ${x.indicatorType} ${x.indicator}${x.pathPattern ?? ""} (${x.classification})`,
        ),
        ...d.removed.map((x) => `- ${x.indicatorType} ${x.indicator}${x.pathPattern ?? ""}`),
        ...d.reclassified.map((x) => `~ ${x.indicator}: ${x.from} → ${x.to}`),
        ...d.validityChanged.map((x) => `~ ${x.indicator}: validity ${x.from} → ${x.to}`),
      ];
      preview.diff = {
        added: d.added.length,
        removed: d.removed.length,
        reclassified: d.reclassified.length,
        validityChanged: d.validityChanged.length,
        unchanged: d.unchanged,
        lines: lines.slice(0, 50),
      };
    }
    return preview;
  }

  private async activateSignedBundle(text: string): Promise<SignedBundlePreview> {
    const preview = await this.previewSignedBundle(text);
    if (!preview.ok) return preview;
    const r = await this.verifyBundleText(text);
    if (!r.ok) return { ok: false, errors: r.errors };
    await this.store.setSignedBundle({
      bundle: JSON.parse(text) as unknown,
      keyId: r.keyId,
      activatedAt: Date.now(),
    });
    this.signedBundle = r.bundle;
    this.rebuildMatcher();
    log("info", `activated signed indicator bundle ${r.bundle.meta.version} (key ${r.keyId})`);
    return preview;
  }

  /** Re-verifies the stored bundle at startup; a failure falls back to the built-in set. */
  private async restoreSignedBundle(): Promise<void> {
    const rec = this.store.getSignedBundle();
    if (!rec) return;
    const setId = this.updatableSetId();
    const builtIn = this.builtInVersionOf(setId);
    const r = await verifySignedBundle(rec.bundle, {
      expectedSetId: setId,
      ...(builtIn !== undefined ? { activeVersion: builtIn } : {}),
    });
    if (r.ok) {
      this.signedBundle = r.bundle;
      log("info", `signed indicator bundle ${r.bundle.meta.version} restored (key ${r.key.keyId})`);
    } else {
      log(
        "warn",
        `stored signed bundle rejected on load (${r.errors.join("; ")}); using the built-in set`,
      );
      await this.store.setSignedBundle(null);
    }
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

  /** STIX / SIEM / hand-off exports over the selected detections and their events. */
  private exportResearch(
    req: Extract<UiRequest, { type: "export_stix" | "export_siem" | "export_handoff" }>,
  ): ExportFile {
    let detections = this.store.listDetections();
    if (req.detectionIds)
      detections = detections.filter((d) => req.detectionIds!.includes(d.detectionId));
    const ids = new Set<string>();
    for (const d of detections) for (const id of d.eventIds) ids.add(id);
    return exportResearch(req, {
      detections,
      events: this.store.getEvents(Array.from(ids)),
      indicatorSets: this.activeSets().filter((s) => !s.meta.synthetic),
      notes: this.store.allNotes(),
      productVersion: __ADTRIPWIRE_VERSION__,
      rulesetVersion: this.eng.rulesetVersion,
      browser: this.capabilities,
      now: new Date(),
    });
  }

  /** Imports a user-supplied indicator set (local file contents) after strict validation. */
  private async importIndicatorSet(
    format: "adtripwire" | "stix",
    text: string,
    enabled: boolean,
  ): Promise<ImportResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, errors: ["not valid JSON"], warnings: [] };
    }
    const warnings: string[] = [];
    let candidate: unknown = parsed;
    if (format === "stix") {
      const converted = stixToIndicatorSet(parsed, {
        setId: `stix-import-${Date.now().toString(36)}`,
        name: "Imported STIX 2.1 bundle",
        license: "as provided by the bundle",
      });
      if (!converted.ok) return { ok: false, errors: converted.errors, warnings };
      warnings.push(...converted.warnings);
      candidate = converted.set;
    }
    const v = validateIndicatorSet(candidate);
    if (!v.ok) return { ok: false, errors: v.errors, warnings };
    if (v.set.meta.synthetic) {
      return {
        ok: false,
        errors: ["synthetic (test) sets cannot be imported into a running extension"],
        warnings,
      };
    }
    if (this.sets.some((b) => b.meta.id === v.set.meta.id)) {
      return {
        ok: false,
        errors: [`set id ${v.set.meta.id} collides with a bundled set`],
        warnings,
      };
    }
    // Bundled curation takes precedence (exact, parent and child overlaps; no url_path).
    const policy = applyBundledPrecedence(v.set, this.curatedSets());
    warnings.push(...summariseDrops(policy.dropped));
    const kept = policy.kept;
    if (kept.length === 0) {
      return {
        ok: false,
        errors: ["no indicators left after de-duplication against the bundled set"],
        warnings,
      };
    }
    const alreadyImported = this.store
      .listImportedSets()
      .filter((r) => r.set.meta.id !== v.set.meta.id)
      .reduce((n, r) => n + r.set.indicators.length, 0);
    if (alreadyImported + kept.length > MAX_IMPORTED_INDICATORS_TOTAL) {
      return {
        ok: false,
        errors: [
          `import would exceed the ${MAX_IMPORTED_INDICATORS_TOTAL}-indicator limit for imported sets (${alreadyImported} already imported); remove a set first`,
        ],
        warnings,
      };
    }
    const finalSet: IndicatorSet = { ...v.set, indicators: kept };
    const evicted = await this.store.addImportedSet({
      set: finalSet,
      enabled,
      importedAt: Date.now(),
      format,
    });
    if (evicted)
      warnings.push(`oldest imported set ${evicted} was removed to stay within the limit`);
    this.rebuildMatcher();
    log(
      "info",
      `imported indicator set ${finalSet.meta.id} (${kept.length} indicators, enabled=${enabled})`,
    );
    return { ok: true, setId: finalSet.meta.id, indicatorCount: kept.length, errors: [], warnings };
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
    // Requests issued by extension pages (including this extension's own loopback model
    // calls in --assist builds) are not web-page traffic and must never become evidence.
    if (isExtensionOriginated(ev)) return false;
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
    if (
      ev.frameContext.thirdParty === true &&
      this.thirdPartyDomains.size < Background.THIRD_PARTY_DOMAINS_MAX
    ) {
      this.thirdPartyDomains.add(clusterDomain(ev.destination.hostname));
    }
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
      indicatorSets: [
        ...this.curatedSets().map((x) => {
          const sb = this.signedBundle;
          const rec = this.store.getSignedBundle();
          if (sb && rec && x.meta.id === sb.payload.meta.id) {
            return {
              ...x.meta,
              signed: {
                keyId: rec.keyId,
                activatedAt: rec.activatedAt,
                builtInVersion: this.builtInVersionOf(x.meta.id) ?? "unknown",
              },
            };
          }
          return x.meta;
        }),
        ...this.store
          .listImportedSets()
          .map((r) => ({ ...r.set.meta, imported: true, enabled: r.enabled })),
      ],
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
      thirdPartyDomains: this.thirdPartyDomains.size,
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
        return list.slice(0, f.limit ?? 500).map((d) => this.withNote(d));
      }
      case "get_detection": {
        const d = this.store.getDetection(req.detectionId);
        return d ? this.withNote(d) : null;
      }
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
          indicatorSets: this.activeSets().map((x) => x.meta),
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
      case "set_detection_note": {
        const d = this.store.getDetection(req.detectionId);
        if (!d) throw new Error("unknown detection");
        await this.store.setNote(req.detectionId, req.note, Date.now());
        return this.withNote(d);
      }
      case "get_timeline": {
        const o: { tabId?: number; since?: number; limit?: number } = {};
        if (req.tabId !== undefined) o.tabId = req.tabId;
        if (req.since !== undefined) o.since = req.since;
        if (req.limit !== undefined) o.limit = req.limit;
        return this.timeline(o);
      }
      case "import_indicator_set":
        return this.importIndicatorSet(req.format, req.text, req.enabled);
      case "remove_indicator_set": {
        await this.store.removeImportedSet(req.setId);
        this.rebuildMatcher();
        return this.status();
      }
      case "set_indicator_set_enabled": {
        await this.store.setImportedSetEnabled(req.setId, req.enabled);
        this.rebuildMatcher();
        return this.status();
      }
      case "export_stix":
      case "export_siem":
      case "export_handoff":
        return this.exportResearch(req);
      case "get_clusters":
        return this.clusters();
      case "get_cluster":
        return this.clusterDetail(req.clusterId);
      case "get_assist_package":
        return this.assistPackage(req);
      case "update_assist_settings":
        return this.store.updateAssistSettings(req.patch);
      case "update_ui_settings":
        return this.store.updateUiSettings(req.patch);
      case "verify_signed_bundle":
        return this.previewSignedBundle(req.text);
      case "activate_signed_bundle":
        return this.activateSignedBundle(req.text);
      case "remove_signed_bundle": {
        await this.store.setSignedBundle(null);
        this.signedBundle = null;
        this.rebuildMatcher();
        return this.status();
      }
    }
  }
}

/** True when the request was issued by an extension page rather than a web page. */
export function isExtensionOriginated(ev: NormalizedEvent): boolean {
  const ext = /^(?:moz|chrome)-extension:/i;
  if (ev.initiatorOrigin && ext.test(ev.initiatorOrigin)) return true;
  const doc = ev.frameContext.documentHostname ?? "";
  const top = ev.frameContext.topHostname ?? "";
  return ext.test(doc) || ext.test(top);
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
    if (__ADTRIPWIRE_DEV__ || __ADTRIPWIRE_EVAL__) {
      // DEV and evaluation builds open the dashboard so an automated run can confirm the UI
      // renders and query status through the UI protocol.
      setTimeout(() => {
        browser.tabs
          .create({ url: browser.runtime.getURL("dashboard.html#detections"), active: false })
          .catch((e) => log("warn", `could not open dashboard: ${String(e)}`));
        if (__ADTRIPWIRE_ASSIST__) {
          browser.tabs
            .create({
              url: browser.runtime.getURL("dashboard.html#assist-selftest"),
              active: false,
            })
            .catch((e) => log("warn", `could not open assist self-test: ${String(e)}`));
        }
      }, 15_000);
    }
  });
}
