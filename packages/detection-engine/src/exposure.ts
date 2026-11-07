import type { ExposureStore } from "./rules/types.js";

export interface ExposureSnapshot {
  version: 1;
  /** hostname -> sorted distinct day keys (YYYY-MM-DD). */
  hosts: Record<string, string[]>;
}

export interface MemoryExposureStoreOptions {
  /** Maximum hostnames tracked; least recently recorded hosts are dropped first. Default 2000. */
  maxHosts?: number;
  /** Maximum day keys retained per host (most recent kept). Default 60. */
  maxDaysPerHost?: number;
}

/** In-memory, bounded exposure counter with a JSON-serialisable snapshot. */
export class MemoryExposureStore implements ExposureStore {
  readonly #hosts = new Map<string, string[]>();
  readonly #maxHosts: number;
  readonly #maxDays: number;

  constructor(opts: MemoryExposureStoreOptions = {}) {
    this.#maxHosts = opts.maxHosts ?? 2000;
    this.#maxDays = opts.maxDaysPerHost ?? 60;
  }

  record(hostname: string, dayKey: string): boolean {
    const days = this.#hosts.get(hostname) ?? [];
    // Re-insert to mark as most recently used.
    this.#hosts.delete(hostname);
    this.#hosts.set(hostname, days);
    if (days.includes(dayKey)) return false;
    days.push(dayKey);
    days.sort();
    while (days.length > this.#maxDays) days.shift();
    while (this.#hosts.size > this.#maxHosts) {
      const oldest = this.#hosts.keys().next().value;
      if (oldest === undefined) break;
      this.#hosts.delete(oldest);
    }
    return days.includes(dayKey);
  }

  distinctDays(hostname: string): number {
    return this.#hosts.get(hostname)?.length ?? 0;
  }

  /** Drops day keys older than `minDay` (YYYY-MM-DD) and hosts left without any day. */
  pruneBefore(minDay: string): void {
    for (const [h, days] of [...this.#hosts]) {
      const kept = days.filter((d) => d >= minDay);
      if (kept.length === 0) this.#hosts.delete(h);
      else if (kept.length !== days.length) this.#hosts.set(h, kept);
    }
  }

  get size(): number {
    return this.#hosts.size;
  }

  toJSON(): ExposureSnapshot {
    const hosts: Record<string, string[]> = {};
    for (const [h, d] of this.#hosts) hosts[h] = [...d];
    return { version: 1, hosts };
  }

  static fromJSON(snapshot: unknown, opts: MemoryExposureStoreOptions = {}): MemoryExposureStore {
    const store = new MemoryExposureStore(opts);
    if (typeof snapshot !== "object" || snapshot === null) return store;
    const hosts = (snapshot as { hosts?: unknown }).hosts;
    if (typeof hosts !== "object" || hosts === null) return store;
    for (const [h, days] of Object.entries(hosts as Record<string, unknown>)) {
      if (!Array.isArray(days)) continue;
      for (const d of days)
        if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) store.record(h, d);
    }
    return store;
  }
}
