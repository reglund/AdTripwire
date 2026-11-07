import type {
  DayStats,
  Detection,
  IndicatorSet,
  NormalizedEvent,
  RetentionSettings,
  Settings,
} from "@adtripwire/shared";
import { DEFAULT_SETTINGS } from "@adtripwire/shared";
import { validateIndicatorSet } from "@adtripwire/indicators";
import { MAX_DAY_ENTRIES, emptyDay, isDateKey, normaliseDay, sanitiseDay } from "./daily.js";

/**
 * Local persistence (browser.storage.local). Only detections and the events they
 * reference are persisted. The correlation window lives in storage.session (memory-only).
 */
const KEY_SETTINGS = "settings";
const KEY_DETECTIONS = "detections";
const KEY_EVENTS = "events";
const KEY_EXPOSURE = "exposure";
const KEY_METRICS = "metrics";
/** Seen-alongside store and its third-party-domain baseline (hostnames and day keys only). */
const KEY_ALONGSIDE = "alongside.v1";
const KEY_ALONGSIDE_BASELINE = "alongside.baseline.v1";
const KEY_IMPORTED_SETS = "importedIndicatorSets";
const KEY_NOTES = "detectionNotes";
const KEY_SIGNED_BUNDLE = "signedIndicatorBundle";
/** Per-day counters (Record<YYYY-MM-DD, DayStats>); counts only, kept 400 days. */
const KEY_DAILY = "daily";

export interface ImportedSetRecord {
  set: IndicatorSet;
  enabled: boolean;
  importedAt: number;
  format: "adtripwire" | "stix";
}

/** A verified signed bundle that replaces the built-in curated set with the same id. */
export interface SignedBundleRecord {
  bundle: unknown; // the full signed bundle JSON; re-verified on load
  keyId: string;
  activatedAt: number;
}

export interface NoteRecord {
  note: string;
  updatedAt: number;
}

const MAX_IMPORTED_SETS = 20;
const MAX_NOTE_LENGTH = 4000;

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
  private importedSets: ImportedSetRecord[] = [];
  private notes = new Map<string, NoteRecord>();
  private signedBundle: SignedBundleRecord | null = null;
  private days = new Map<string, DayStats>();
  private dailyLoaded = false;
  private dailyDirty = false;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  async load(): Promise<void> {
    const data = await browser.storage.local.get([
      KEY_SETTINGS,
      KEY_DETECTIONS,
      KEY_EVENTS,
      KEY_IMPORTED_SETS,
      KEY_NOTES,
      KEY_SIGNED_BUNDLE,
      KEY_DAILY,
    ]);
    const daily = data[KEY_DAILY];
    this.days = new Map(
      daily && typeof daily === "object" && !Array.isArray(daily)
        ? Object.entries(daily as Record<string, unknown>).flatMap(([k, v]) => {
            const day = sanitiseDay(k, v);
            return day ? [[k, day] as const] : [];
          })
        : [],
    );
    this.dailyLoaded = true;
    const sb = data[KEY_SIGNED_BUNDLE] as SignedBundleRecord | undefined;
    this.signedBundle =
      sb &&
      typeof sb === "object" &&
      typeof sb.keyId === "string" &&
      typeof sb.activatedAt === "number"
        ? sb
        : null;
    // Stored imports are re-validated on load so a stale or corrupted record can never
    // re-enter the matcher.
    this.importedSets = (
      Array.isArray(data[KEY_IMPORTED_SETS]) ? (data[KEY_IMPORTED_SETS] as ImportedSetRecord[]) : []
    ).flatMap((r) => {
      const v = validateIndicatorSet(r?.set);
      return v.ok && typeof r.enabled === "boolean" ? [{ ...r, set: v.set }] : [];
    });
    const notes = data[KEY_NOTES];
    this.notes = new Map(
      notes && typeof notes === "object" ? Object.entries(notes as Record<string, NoteRecord>) : [],
    );
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

  // ---- per-day counters ----

  getDay(date: string): DayStats | undefined {
    return this.days.get(date);
  }

  /** Upserts one day: `fn` mutates the (possibly new) record, which is then clamped. */
  updateDay(date: string, fn: (day: DayStats) => void): void {
    if (!isDateKey(date)) return;
    const day = this.days.get(date) ?? emptyDay(date);
    fn(day);
    this.days.set(date, normaliseDay(day));
    this.dailyDirty = true;
  }

  /** Newest first, at most 400 entries. */
  listDays(): DayStats[] {
    return Array.from(this.days.values())
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, MAX_DAY_ENTRIES);
  }

  /** Writes the counters if changed. Never writes before `load()` (would overwrite stored days). */
  async flushDaily(): Promise<void> {
    if (!this.dailyLoaded || !this.dailyDirty) return;
    this.dailyDirty = false;
    try {
      await browser.storage.local.set({ [KEY_DAILY]: Object.fromEntries(this.days) });
    } catch {
      this.dailyDirty = true;
    }
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

  /** The stored signed bundle, if any. The background re-verifies it before use. */
  getSignedBundle(): SignedBundleRecord | null {
    return this.signedBundle;
  }

  async setSignedBundle(rec: SignedBundleRecord | null): Promise<void> {
    this.signedBundle = rec;
    if (rec) await browser.storage.local.set({ [KEY_SIGNED_BUNDLE]: rec });
    else await browser.storage.local.remove(KEY_SIGNED_BUNDLE);
  }

  async updateUiSettings(patch: Partial<Settings["ui"]>): Promise<Settings> {
    const ui = { ...this.settings.ui };
    if (patch.language !== undefined) ui.language = patch.language;
    const next: Settings = { ...this.settings, ui };
    this.settings = next;
    await browser.storage.local.set({ [KEY_SETTINGS]: next });
    return next;
  }

  /** Assist settings are validated by the message parser; this only clamps and persists. */
  async updateAssistSettings(patch: Partial<Settings["assist"]>): Promise<Settings> {
    const assist = { ...this.settings.assist };
    if (patch.enabled !== undefined) assist.enabled = patch.enabled;
    if (patch.port !== undefined) assist.port = clamp(patch.port, 1, 65535);
    if (patch.model !== undefined) assist.model = patch.model.slice(0, 128);
    if (patch.language !== undefined) assist.language = patch.language;
    const next: Settings = { ...this.settings, assist };
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
    // Day counters: keep the 400 newest by date (not by age, so a clock jump cannot wipe them).
    if (this.days.size > MAX_DAY_ENTRIES) {
      const keep = new Set(this.listDays().map((d) => d.date));
      for (const k of Array.from(this.days.keys())) if (!keep.has(k)) this.days.delete(k);
      this.dailyDirty = true;
    }
    const kept = new Set(this.detections.map((d) => d.detectionId));
    let notesChanged = false;
    for (const id of Array.from(this.notes.keys()))
      if (!kept.has(id)) {
        this.notes.delete(id);
        notesChanged = true;
      }
    if (notesChanged)
      void browser.storage.local.set({ [KEY_NOTES]: Object.fromEntries(this.notes) });
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
    this.days.clear();
    this.dailyDirty = false;
    const keep = this.settings;
    const keepSets = this.importedSets;
    this.notes.clear();
    await browser.storage.local.clear();
    await browser.storage.local.set({ [KEY_SETTINGS]: keep, [KEY_IMPORTED_SETS]: keepSets });
    try {
      await browser.storage.session.clear();
    } catch {
      /* storage.session may be unavailable */
    }
  }

  // ---- imported indicator sets ----

  listImportedSets(): ImportedSetRecord[] {
    return this.importedSets;
  }

  /** Adds or replaces an imported set; returns the id of an evicted oldest set, if any. */
  async addImportedSet(rec: ImportedSetRecord): Promise<string | undefined> {
    this.importedSets = this.importedSets.filter((r) => r.set.meta.id !== rec.set.meta.id);
    this.importedSets.push(rec);
    let evicted: string | undefined;
    if (this.importedSets.length > MAX_IMPORTED_SETS)
      evicted = this.importedSets.shift()?.set.meta.id;
    await browser.storage.local.set({ [KEY_IMPORTED_SETS]: this.importedSets });
    return evicted;
  }

  async removeImportedSet(setId: string): Promise<boolean> {
    const before = this.importedSets.length;
    this.importedSets = this.importedSets.filter((r) => r.set.meta.id !== setId);
    await browser.storage.local.set({ [KEY_IMPORTED_SETS]: this.importedSets });
    return this.importedSets.length < before;
  }

  async setImportedSetEnabled(setId: string, enabled: boolean): Promise<boolean> {
    const rec = this.importedSets.find((r) => r.set.meta.id === setId);
    if (!rec) return false;
    rec.enabled = enabled;
    await browser.storage.local.set({ [KEY_IMPORTED_SETS]: this.importedSets });
    return true;
  }

  // ---- analyst notes ----

  getNote(detectionId: string): NoteRecord | undefined {
    return this.notes.get(detectionId);
  }

  async setNote(detectionId: string, note: string, now: number): Promise<NoteRecord | undefined> {
    const trimmed = note.slice(0, MAX_NOTE_LENGTH);
    if (trimmed.trim().length === 0) this.notes.delete(detectionId);
    else this.notes.set(detectionId, { note: trimmed, updatedAt: now });
    await browser.storage.local.set({ [KEY_NOTES]: Object.fromEntries(this.notes) });
    return this.notes.get(detectionId);
  }

  allNotes(): ReadonlyMap<string, NoteRecord> {
    return this.notes;
  }

  async getExposureSnapshot(): Promise<unknown> {
    const d = await browser.storage.local.get(KEY_EXPOSURE);
    return d[KEY_EXPOSURE];
  }

  async setExposureSnapshot(s: unknown): Promise<void> {
    await browser.storage.local.set({ [KEY_EXPOSURE]: s });
  }

  async getAlongsideSnapshot(): Promise<{ store: unknown; baseline: unknown }> {
    const d = await browser.storage.local.get([KEY_ALONGSIDE, KEY_ALONGSIDE_BASELINE]);
    return { store: d[KEY_ALONGSIDE], baseline: d[KEY_ALONGSIDE_BASELINE] };
  }

  async setAlongsideSnapshot(store: unknown, baseline: unknown): Promise<void> {
    await browser.storage.local.set({ [KEY_ALONGSIDE]: store, [KEY_ALONGSIDE_BASELINE]: baseline });
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
    assist: mergeAssist(r.assist),
    ui: {
      language: (["auto", "en", "nb"] as const).find((l) => l === r.ui?.language) ?? "auto",
    },
  };
}

function mergeAssist(raw: unknown): Settings["assist"] {
  const d = DEFAULT_SETTINGS.assist;
  const a = (raw ?? {}) as Partial<Record<keyof Settings["assist"], unknown>>;
  return {
    enabled: typeof a.enabled === "boolean" ? a.enabled : d.enabled,
    port:
      typeof a.port === "number" && Number.isInteger(a.port) && a.port >= 1 && a.port <= 65535
        ? a.port
        : d.port,
    model:
      typeof a.model === "string" && /^(?:[A-Za-z0-9][A-Za-z0-9._:/-]{0,127})?$/.test(a.model)
        ? a.model
        : d.model,
    language: a.language === "nb" ? "nb" : "en",
  };
}
