import type { NormalizedEvent } from "@adtripwire/shared";
import type { EventWindow } from "./rules/types.js";

export const DEFAULT_MAX_WINDOW_EVENTS = 5000;

/** FIFO bucket with O(1) amortised removal from the front. */
class Bucket {
  items: NormalizedEvent[] = [];
  head = 0;
  get size(): number {
    return this.items.length - this.head;
  }
  push(e: NormalizedEvent): void {
    this.items.push(e);
  }
  shiftIf(e: NormalizedEvent): void {
    if (this.items[this.head] === e) {
      this.items[this.head] = undefined as unknown as NormalizedEvent;
      this.head++;
      if (this.head > 64 && this.head * 2 > this.items.length) {
        this.items = this.items.slice(this.head);
        this.head = 0;
      }
    }
  }
  toArray(): NormalizedEvent[] {
    return this.items.slice(this.head);
  }
}

/**
 * Bounded event window: at most `maxEvents` events (oldest evicted first) and nothing older
 * than `windowMs` relative to the prune reference time. Indexed by request id, correlation id and tab.
 */
export class BoundedEventWindow implements EventWindow {
  readonly #all = new Bucket();
  readonly #byRequest = new Map<string, Bucket>();
  readonly #byCorrelation = new Map<string, Bucket>();
  readonly #byTab = new Map<number, Bucket>();

  constructor(
    readonly maxEvents: number = DEFAULT_MAX_WINDOW_EVENTS,
    public windowMs: number,
  ) {}

  get size(): number {
    return this.#all.size;
  }

  /** Number of index buckets currently held (for boundedness checks). */
  get indexSizes(): { requests: number; correlations: number; tabs: number } {
    return {
      requests: this.#byRequest.size,
      correlations: this.#byCorrelation.size,
      tabs: this.#byTab.size,
    };
  }

  add(e: NormalizedEvent): void {
    this.#all.push(e);
    if (e.requestId !== undefined) this.#index(this.#byRequest, e.requestId, e);
    if (e.correlationId !== undefined) this.#index(this.#byCorrelation, e.correlationId, e);
    if (e.tabId !== undefined) this.#index(this.#byTab, e.tabId, e);
    while (this.#all.size > this.maxEvents) this.#evictOldest();
  }

  prune(reference: number): void {
    const cutoff = reference - this.windowMs;
    while (this.#all.size > 0) {
      const oldest = this.#all.items[this.#all.head]!;
      if (oldest.timestamp >= cutoff) break;
      this.#evictOldest();
    }
  }

  recent(): readonly NormalizedEvent[] {
    return this.#all.toArray();
  }
  byRequestId(id: string): NormalizedEvent[] {
    return this.#byRequest.get(id)?.toArray() ?? [];
  }
  byCorrelationId(id: string): NormalizedEvent[] {
    return this.#byCorrelation.get(id)?.toArray() ?? [];
  }
  byTab(tabId: number): NormalizedEvent[] {
    return this.#byTab.get(tabId)?.toArray() ?? [];
  }

  #index<K>(map: Map<K, Bucket>, key: K, e: NormalizedEvent): void {
    let b = map.get(key);
    if (!b) {
      b = new Bucket();
      map.set(key, b);
    }
    b.push(e);
  }

  #unindex<K>(map: Map<K, Bucket>, key: K, e: NormalizedEvent): void {
    const b = map.get(key);
    if (!b) return;
    b.shiftIf(e);
    if (b.size === 0) map.delete(key);
  }

  #evictOldest(): void {
    const e = this.#all.items[this.#all.head];
    if (!e) return;
    this.#all.shiftIf(e);
    if (e.requestId !== undefined) this.#unindex(this.#byRequest, e.requestId, e);
    if (e.correlationId !== undefined) this.#unindex(this.#byCorrelation, e.correlationId, e);
    if (e.tabId !== undefined) this.#unindex(this.#byTab, e.tabId, e);
  }
}
