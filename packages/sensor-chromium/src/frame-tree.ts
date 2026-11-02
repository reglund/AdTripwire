import { hostnameOf } from "@adtripwire/privacy";

/** Minimal slice of `chrome.webNavigation.getAllFrames` the cache needs (promise form). */
export interface FrameLookupApi {
  getAllFrames(details: { tabId: number }): Promise<
    | Array<{
        frameId: number;
        parentFrameId: number;
        url: string;
        documentId?: string | undefined;
      }>
    | null
    | undefined
  >;
}

/** Fields of webNavigation onBeforeNavigate / onCommitted details we read. */
export interface NavigationDetailsLike {
  tabId: number;
  frameId: number;
  /**
   * Present on Chrome >= 74 for onBeforeNavigate and onCommitted (older @types/chrome omit it
   * for onCommitted). When missing, the parent recorded by onBeforeNavigate is kept.
   */
  parentFrameId?: number | undefined;
  url: string;
  documentId?: string | undefined;
}

interface FrameEntry {
  /** -1 for the top-level frame; undefined when the parent is not known (yet). */
  parentFrameId: number | undefined;
  /** Sanitized hostname, or null for about:blank / srcdoc / data: frames (inherit at query time). */
  hostname: string | null;
  documentId?: string;
}

export interface FrameAncestry {
  /** Ancestor frame ids, immediate parent (or the start frame) first, top-level frame last. */
  frameIds: number[];
  /** Hostnames aligned with frameIds. */
  hostnames: string[];
  /** True when the walk reached the top-level frame with every link known. */
  complete: boolean;
}

export const FRAME_TREE_MAX_TABS = 200;
export const FRAME_TREE_MAX_FRAMES_PER_TAB = 300;
export const FRAME_TREE_REFRESH_COOLDOWN_MS = 1000;

/**
 * Per-tab frame tree reconstructed from webNavigation. Chromium webRequest details carry no
 * frame ancestry, so this cache rebuilds it from navigation events and (lazily) from
 * `getAllFrames`. It is asynchronous by nature: a request may arrive before the commit of the
 * frame that issued it, in which case the answer is `undefined` and a refresh is scheduled.
 *
 * Bounded: at most FRAME_TREE_MAX_TABS tabs (least recently used evicted) and
 * FRAME_TREE_MAX_FRAMES_PER_TAB frames per tab (oldest inserted non-top frame evicted).
 */
export class FrameTreeCache {
  private readonly tabs = new Map<number, Map<number, FrameEntry>>();
  private readonly refreshing = new Map<number, Promise<void>>();
  private readonly lastRefreshAt = new Map<number, number>();

  constructor(
    private readonly api?: FrameLookupApi,
    private readonly limits = {
      maxTabs: FRAME_TREE_MAX_TABS,
      maxFramesPerTab: FRAME_TREE_MAX_FRAMES_PER_TAB,
    },
    private readonly now: () => number = Date.now,
    /** Minimum interval between getAllFrames refreshes of the same tab. */
    private readonly refreshCooldownMs = FRAME_TREE_REFRESH_COOLDOWN_MS,
  ) {}

  /** webNavigation.onBeforeNavigate: provisional insert only when the frame is unknown. */
  onBeforeNavigate(d: NavigationDetailsLike): void {
    if (d.tabId < 0) return;
    const frames = this.tabFrames(d.tabId, true)!;
    if (frames.has(d.frameId)) return;
    this.put(frames, d.frameId, entryOf(d));
  }

  /**
   * webNavigation.onCommitted: authoritative. Overwrites the entry and prunes the frame's
   * descendants (their documents are gone). A top-level commit drops the rest of the tab.
   */
  onCommitted(d: NavigationDetailsLike): void {
    if (d.tabId < 0) return;
    if (d.frameId === 0) {
      const fresh = new Map<number, FrameEntry>();
      fresh.set(0, entryOf(d));
      this.tabs.delete(d.tabId);
      this.tabs.set(d.tabId, fresh);
      this.evictTabs();
      return;
    }
    const frames = this.tabFrames(d.tabId, true)!;
    const prevParent = frames.get(d.frameId)?.parentFrameId;
    const next = entryOf(d);
    if (next.parentFrameId === undefined && prevParent !== undefined)
      next.parentFrameId = prevParent;
    this.pruneDescendants(frames, d.frameId);
    frames.delete(d.frameId);
    this.put(frames, d.frameId, next);
  }

  /** tabs.onRemoved. */
  onTabRemoved(tabId: number): void {
    this.tabs.delete(tabId);
    this.refreshing.delete(tabId);
    this.lastRefreshAt.delete(tabId);
  }

  /** Known parent of a frame, or undefined. */
  parentOf(tabId: number, frameId: number): number | undefined {
    return this.tabs.get(tabId)?.get(frameId)?.parentFrameId;
  }

  /** Hostname of a frame's current document (inherited for about:blank-like frames), if known. */
  hostnameOf(tabId: number, frameId: number): string | undefined {
    const frames = this.tabs.get(tabId);
    if (!frames) return undefined;
    return resolveHost(frames, frameId) ?? undefined;
  }

  /** documentId recorded for the frame, if any (used to detect stale entries). */
  documentIdOf(tabId: number, frameId: number): string | undefined {
    return this.tabs.get(tabId)?.get(frameId)?.documentId;
  }

  /**
   * Ancestors of `frameId` (excluding the frame itself), immediate parent first, top last.
   * Returns undefined when the frame is unknown. Frame 0 has an empty, complete ancestry.
   */
  ancestry(tabId: number, frameId: number): FrameAncestry | undefined {
    const frames = this.tabFrames(tabId, false);
    if (!frames) return undefined;
    if (frameId === 0 && frames.has(0)) return { frameIds: [], hostnames: [], complete: true };
    const entry = frames.get(frameId);
    if (!entry) return undefined;
    if (entry.parentFrameId === undefined) return { frameIds: [], hostnames: [], complete: false };
    if (entry.parentFrameId < 0) {
      // A non-zero frame without a parent (prerender / fenced outermost frame): not a top doc.
      return { frameIds: [], hostnames: [], complete: false };
    }
    return (
      this.chainFrom(tabId, entry.parentFrameId) ?? { frameIds: [], hostnames: [], complete: false }
    );
  }

  /**
   * The chain starting AT `startFrameId` (inclusive) up to the top-level frame. Used for
   * sub_frame requests, whose own frame is not yet committed but whose parent is.
   */
  chainFrom(tabId: number, startFrameId: number): FrameAncestry | undefined {
    const frames = this.tabFrames(tabId, false);
    if (!frames || !frames.has(startFrameId)) return undefined;
    const frameIds: number[] = [];
    const hostnames: string[] = [];
    let complete = true;
    let cur = startFrameId;
    const seen = new Set<number>();
    while (cur >= 0) {
      if (seen.has(cur) || seen.size > this.limits.maxFramesPerTab) {
        complete = false; // cycle or runaway: never trust it
        break;
      }
      seen.add(cur);
      const e = frames.get(cur);
      if (!e) {
        complete = false;
        break;
      }
      const host = resolveHost(frames, cur);
      if (host) {
        frameIds.push(cur);
        hostnames.push(host);
      } else {
        complete = false;
      }
      if (cur === 0) break;
      if (e.parentFrameId === undefined) {
        complete = false;
        break;
      }
      cur = e.parentFrameId;
    }
    if (cur !== 0 && complete) complete = false;
    return { frameIds, hostnames, complete };
  }

  /**
   * Schedules a `getAllFrames` refresh for a tab (de-duplicated while in flight). Resolves
   * when the refresh finished; failures are swallowed (the tab may be gone).
   */
  refresh(tabId: number): Promise<void> {
    if (!this.api || tabId < 0) return Promise.resolve();
    const inflight = this.refreshing.get(tabId);
    if (inflight) return inflight;
    // Cooldown: frames that never resolve (prerender, fenced frames, broken chains) must not
    // trigger getAllFrames on every request.
    const t = this.now();
    const last = this.lastRefreshAt.get(tabId);
    if (last !== undefined && t - last < this.refreshCooldownMs) return Promise.resolve();
    if (this.lastRefreshAt.size >= this.limits.maxTabs * 2) this.lastRefreshAt.clear();
    this.lastRefreshAt.set(tabId, t);
    const p: Promise<void> = this.doRefresh(tabId, () => this.refreshing.get(tabId) === p).finally(
      () => {
        if (this.refreshing.get(tabId) === p) this.refreshing.delete(tabId);
      },
    );
    this.refreshing.set(tabId, p);
    return p;
  }

  private async doRefresh(tabId: number, stillWanted: () => boolean): Promise<void> {
    try {
      const list = await this.api!.getAllFrames({ tabId });
      if (!list || !stillWanted()) return;
      const frames = this.tabFrames(tabId, true)!;
      for (const f of list) {
        const prev = frames.get(f.frameId);
        const next = entryOf(f);
        // Do not let a refresh downgrade a committed entry to an about:blank placeholder.
        if (prev && prev.hostname && !next.hostname && prev.documentId === next.documentId)
          continue;
        frames.delete(f.frameId);
        this.put(frames, f.frameId, next);
      }
    } catch {
      // Tab closed or API unavailable: leave the cache as is.
    }
  }

  get size(): { tabs: number; frames: number } {
    let frames = 0;
    for (const m of this.tabs.values()) frames += m.size;
    return { tabs: this.tabs.size, frames };
  }

  clear(): void {
    this.tabs.clear();
    this.refreshing.clear();
    this.lastRefreshAt.clear();
  }

  private tabFrames(tabId: number, create: boolean): Map<number, FrameEntry> | undefined {
    let frames = this.tabs.get(tabId);
    if (frames) {
      // LRU touch.
      this.tabs.delete(tabId);
      this.tabs.set(tabId, frames);
      return frames;
    }
    if (!create) return undefined;
    frames = new Map();
    this.tabs.set(tabId, frames);
    this.evictTabs();
    return frames;
  }

  private evictTabs(): void {
    while (this.tabs.size > this.limits.maxTabs) {
      const oldest = this.tabs.keys().next().value as number;
      this.tabs.delete(oldest);
      this.refreshing.delete(oldest);
      this.lastRefreshAt.delete(oldest);
    }
  }

  private put(frames: Map<number, FrameEntry>, frameId: number, e: FrameEntry): void {
    frames.set(frameId, e);
    if (frames.size <= this.limits.maxFramesPerTab) return;
    for (const id of frames.keys()) {
      if (id === 0 || id === frameId) continue;
      frames.delete(id);
      if (frames.size <= this.limits.maxFramesPerTab) break;
    }
  }

  private pruneDescendants(frames: Map<number, FrameEntry>, rootId: number): void {
    let changed = true;
    const dead = new Set<number>([rootId]);
    while (changed) {
      changed = false;
      for (const [id, e] of frames) {
        if (!dead.has(id) && e.parentFrameId !== undefined && dead.has(e.parentFrameId)) {
          dead.add(id);
          changed = true;
        }
      }
    }
    dead.delete(rootId);
    for (const id of dead) frames.delete(id);
  }
}

function entryOf(d: {
  parentFrameId?: number | undefined;
  url: string;
  frameId: number;
  documentId?: string | undefined;
}): FrameEntry {
  const e: FrameEntry = {
    parentFrameId: d.frameId === 0 ? -1 : d.parentFrameId,
    hostname: hostnameOf(d.url),
  };
  if (d.documentId) e.documentId = d.documentId;
  return e;
}

/** about:blank / srcdoc frames inherit the nearest known ancestor's host. */
function resolveHost(frames: Map<number, FrameEntry>, frameId: number): string | null {
  let cur = frameId;
  for (let i = 0; i <= frames.size && cur >= 0; i++) {
    const e = frames.get(cur);
    if (!e) return null;
    if (e.hostname) return e.hostname;
    if (e.parentFrameId === undefined) return null;
    cur = e.parentFrameId;
  }
  return null;
}
