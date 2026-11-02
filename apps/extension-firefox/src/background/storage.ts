import type { Detection, NormalizedEvent, RetentionSettings, Settings } from "@adtripwire/shared";
import { DEFAULT_SETTINGS } from "@adtripwire/shared";

/**
 * Local persistence (browser.storage.local). Only detections and the events they
 * reference are persisted. The correlation window lives in storage.session (memory-only).
 */
const KEY_SETTINGS = "settings";
const KEY_DETECTIONS = "detections";
const KEY_EVENTS = "events";
const KEY_EXPOSURE = "exposure";
const KEY_METRICS = "metrics";

export interface Metrics {
  eventsObserved: number;
  eventsIngested: number;
  inspections: number;
  inspectedBytes: number;
  passThroughMsTotal: number;
  analysisMsTotal: number;
  ingestMsTotal: number;
  startedAt: number;
}

export const EMPTY_METRICS: Metrics = {
  eventsObserved: 0,
  eventsIngested: 0,
  inspections: 0,
  inspectedBytes: 0,
  passThroughMsTotal: 0,
  analysisMsTotal: 0,
  ingestMsTotal: 0,
  startedAt: Date.now(),
};

export class LocalStore {
  private detections: Detection[] = [];
  private events = new Map<string, NormalizedEvent>();
  private settings: Settings = DEFAULT_SETTINGS;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  async load(): Promise<void> {
    const data = await browser.storage.local.get([KEY_SETTINGS, KEY_DETECTIONS, KEY_EVENTS]);
    this.settings = mergeSettings(data[KEY_SETTINGS]);
    this.detections = Array.isArray(data[KEY_DETECTIONS])
      ? (data[KEY_DETECTIONS] as Detection[])
      : [];
    const evs = Array.isArray(data[KEY_EVENTS]) ? (data[KEY_EVENTS] as NormalizedEvent[]) : [];
    this.events = new Map(evs.map((e) => [e.eventId, e]));
  }

  getSettings(): Settings {
    return this.settings;
  }

  async updateSettings(
    patch: Partial<Settings["monitoring"]> & Partial<Settings["retention"]>,
  ): Promise<Settings> {
    const next: Settings = {
      ...this.settings,
      monitoring: { ...this.settings.monitoring },
      retention: { ...this.settings.retention },
    };
    const mon = next.monitoring as unknown as Record<string, unknown>;
    const ret = next.retention as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (k in mon && typeof v === typeof mon[k]) mon[k] = v;
      else if (k in ret && typeof v === "number" && Number.isFinite(v)) ret[k] = v;
    }
    next.monitoring.responseInspectionMaxBytes = clamp(
      next.monitoring.responseInspectionMaxBytes,
      16 * 1024,
      4 * 1024 * 1024,
    );
    next.monitoring.correlationWindowMs = clamp(
      next.monitoring.correlationWindowMs,
      30_000,
      60 * 60 * 1000,
    );
    next.retention.detectionRetentionDays = clamp(next.retention.detectionRetentionDays, 1, 365);
    next.retention.maxDetections = clamp(next.retention.maxDetections, 50, 50_000);
    next.retention.maxEvents = clamp(next.retention.maxEvents, 500, 200_000);
    this.settings = next;
    await browser.storage.local.set({ [KEY_SETTINGS]: next });
    return next;
  }

  listDetections(): Detection[] {
    return this.detections;
  }

  getDetection(id: string): Detection | undefined {
    return this.detections.find((d) => d.detectionId === id);
  }

  getEvents(ids: string[]): NormalizedEvent[] {
    const out: NormalizedEvent[] = [];
    for (const id of ids) {
      const e = this.events.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  allEvents(): NormalizedEvent[] {
    return Array.from(this.events.values());
  }

  /** Persists a detection with its supporting events (events only when referenced). */
  addDetection(d: Detection, supporting: NormalizedEvent[]): void {
    this.detections.push(d);
    for (const e of supporting) if (!this.events.has(e.eventId)) this.events.set(e.eventId, e);
    this.scheduleFlush();
  }

  addSupportingEvent(e: NormalizedEvent): void {
    if (this.events.has(e.eventId)) return;
    this.events.set(e.eventId, e);
    this.scheduleFlush();
  }

  updateDetection(d: Detection): void {
    const i = this.detections.findIndex((x) => x.detectionId === d.detectionId);
    if (i >= 0) this.detections[i] = d;
    else this.detections.push(d);
    this.scheduleFlush();
  }

  /** Applies retention: age, count caps, and orphan event removal. */
  applyRetention(
    now: number,
    r: RetentionSettings,
  ): { removedDetections: number; removedEvents: number } {
    const cutoff = now - r.detectionRetentionDays * 86_400_000;
    const before = this.detections.length;
    this.detections = this.detections.filter((d) => d.timestamp >= cutoff);
    if (this.detections.length > r.maxDetections) {
      this.detections.sort((a, b) => a.timestamp - b.timestamp);
      this.detections = this.detections.slice(this.detections.length - r.maxDetections);
    }
    const referenced = new Set<string>();
    for (const d of this.detections) for (const id of d.eventIds) referenced.add(id);
    const evBefore = this.events.size;
    for (const id of Array.from(this.events.keys()))
      if (!referenced.has(id)) this.events.delete(id);
    if (this.events.size > r.maxEvents) {
      const sorted = Array.from(this.events.values()).sort((a, b) => a.timestamp - b.timestamp);
      for (const e of sorted.slice(0, this.events.size - r.maxEvents))
        this.events.delete(e.eventId);
    }
    const removed = {
      removedDetections: before - this.detections.length,
      removedEvents: evBefore - this.events.size,
    };
    if (removed.removedDetections || removed.removedEvents) this.scheduleFlush();
    return removed;
  }

  async deleteAll(): Promise<void> {
    this.detections = [];
    this.events.clear();
    const keep = this.settings;
    await browser.storage.local.clear();
    await browser.storage.local.set({ [KEY_SETTINGS]: keep });
    try {
      await browser.storage.session.clear();
    } catch {
      /* storage.session may be unavailable */
    }
  }

  async getExposureSnapshot(): Promise<unknown> {
    const d = await browser.storage.local.get(KEY_EXPOSURE);
    return d[KEY_EXPOSURE];
  }

  async setExposureSnapshot(s: unknown): Promise<void> {
    await browser.storage.local.set({ [KEY_EXPOSURE]: s });
  }

  async getMetrics(): Promise<Metrics> {
    const d = await browser.storage.local.get(KEY_METRICS);
    const m = d[KEY_METRICS] as Partial<Metrics> | undefined;
    return { ...EMPTY_METRICS, ...(m ?? {}) };
  }

  async setMetrics(m: Metrics): Promise<void> {
    await browser.storage.local.set({ [KEY_METRICS]: m });
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => void this.flush(), 500);
  }

  async flush(): Promise<void> {
    this.flushTimer = undefined;
    if (!this.dirty) return;
    this.dirty = false;
    await browser.storage.local.set({
      [KEY_DETECTIONS]: this.detections,
      [KEY_EVENTS]: Array.from(this.events.values()),
    });
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function mergeSettings(raw: unknown): Settings {
  const r = (raw ?? {}) as Partial<Settings>;
  return {
    schemaVersion: 1,
    monitoring: { ...DEFAULT_SETTINGS.monitoring, ...(r.monitoring ?? {}) },
    retention: { ...DEFAULT_SETTINGS.retention, ...(r.retention ?? {}) },
  };
}
