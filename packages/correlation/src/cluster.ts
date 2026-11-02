/**
 * Deterministic clustering of detections. Two detections join the same cluster when they
 * cite the same event, matched the same indicator, name the same subject hostname or
 * registrable domain, or occurred in the same tab within the correlation window of each
 * other. Union-find over keyed indexes keeps this linear in the number of detections.
 */
import {
  fnv1a,
  type ClusterLink,
  type ClusterLinkReason,
  type Detection,
  type DetectionCategory,
  type DetectionCluster,
} from "@adtripwire/shared";
import { registrableDomain } from "@adtripwire/indicators";
import { maxSeverity, SEVERITY_TEXT } from "./severity.js";

export interface ClusterOptions {
  /** Same-tab proximity that links two detections (ms). */
  windowMs: number;
  /**
   * Maximum distance in time between two detections for a shared hostname, domain or
   * indicator to link them (ms). Shared events link regardless. Bounds how far a common
   * ad-platform domain can chain unrelated activity. Default 24 h.
   */
  infrastructureWindowMs?: number;
  /** Safety cap on detections considered (newest kept). */
  maxDetections?: number;
}

const DEFAULT_MAX = 5000;
const DEFAULT_INFRA_WINDOW_MS = 24 * 60 * 60 * 1000;

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r]!;
    while (this.parent[i] !== r) {
      const next = this.parent[i]!;
      this.parent[i] = r;
      i = next;
    }
    return r;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    // Attach the higher root to the lower so the root is the oldest member (sorted input).
    if (ra < rb) this.parent[rb] = ra;
    else this.parent[ra] = rb;
    return true;
  }
}

export function clusterDomain(hostname: string): string {
  return registrableDomain(hostname) ?? hostname.toLowerCase();
}

function sortedUnique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort();
}

export function clusterDetections(
  input: readonly Detection[],
  opts: ClusterOptions,
): DetectionCluster[] {
  const cap = opts.maxDetections ?? DEFAULT_MAX;
  let dets = [...input].sort(
    (a, b) => a.timestamp - b.timestamp || a.detectionId.localeCompare(b.detectionId),
  );
  if (dets.length > cap) dets = dets.slice(dets.length - cap);
  const n = dets.length;
  const uf = new UnionFind(n);
  const links: ClusterLink[] = [];

  const infraWindow = opts.infrastructureWindowMs ?? DEFAULT_INFRA_WINDOW_MS;
  // Each key remembers the most recent detection that carried it; a new carrier links to it
  // only when close enough in time (shared events always link).
  const link = (
    lastSeen: Map<string, number>,
    key: string,
    idx: number,
    reason: ClusterLinkReason,
  ): void => {
    const prev = lastSeen.get(key);
    lastSeen.set(key, idx);
    if (prev === undefined) return;
    if (reason !== "shared_event" && dets[idx]!.timestamp - dets[prev]!.timestamp > infraWindow)
      return;
    if (uf.union(prev, idx)) {
      links.push({ from: dets[prev]!.detectionId, to: dets[idx]!.detectionId, reason, key });
    }
  };

  const byEvent = new Map<string, number>();
  const byIndicator = new Map<string, number>();
  const byHost = new Map<string, number>();
  const byDomain = new Map<string, number>();
  const lastInTab = new Map<number, number>();

  dets.forEach((d, i) => {
    for (const e of d.eventIds) link(byEvent, e, i, "shared_event");
    for (const ind of d.matchedIndicatorIds) link(byIndicator, ind, i, "shared_indicator");
    for (const h of d.subjectHostnames) {
      const host = h.toLowerCase();
      link(byHost, host, i, "shared_hostname");
      link(byDomain, clusterDomain(host), i, "shared_domain");
    }
    if (d.tabId !== undefined) {
      const prev = lastInTab.get(d.tabId);
      if (prev !== undefined && d.timestamp - dets[prev]!.timestamp <= opts.windowMs) {
        if (uf.union(prev, i))
          links.push({
            from: dets[prev]!.detectionId,
            to: d.detectionId,
            reason: "same_tab_window",
            key: String(d.tabId),
          });
      }
      lastInTab.set(d.tabId, i);
    }
  });

  const groups = new Map<number, Detection[]>();
  dets.forEach((d, i) => {
    const r = uf.find(i);
    const g = groups.get(r);
    if (g) g.push(d);
    else groups.set(r, [d]);
  });
  const linksByDetection = new Map<string, ClusterLink[]>();
  for (const l of links) {
    const arr = linksByDetection.get(l.to) ?? [];
    arr.push(l);
    linksByDetection.set(l.to, arr);
  }

  const clusters: DetectionCluster[] = [];
  for (const members of groups.values()) {
    const ids = members.map((m) => m.detectionId);
    const hostnames = sortedUnique(
      members.flatMap((m) => m.subjectHostnames.map((h) => h.toLowerCase())),
    );
    const cluster: DetectionCluster = {
      clusterId: `c-${fnv1a(ids[0]!)}`,
      detectionIds: ids,
      firstTimestamp: members[0]!.timestamp,
      lastTimestamp: members[members.length - 1]!.timestamp,
      maxSeverity: maxSeverity(members.map((m) => m.severity)),
      categories: sortedUnique(members.map((m) => m.category)) as DetectionCategory[],
      ruleIds: sortedUnique(members.map((m) => m.ruleId)),
      tabIds: sortedUnique(members.flatMap((m) => (m.tabId !== undefined ? [m.tabId] : []))).sort(
        (a, b) => a - b,
      ),
      hostnames,
      registrableDomains: sortedUnique(hostnames.map(clusterDomain)),
      indicatorIds: sortedUnique(members.flatMap((m) => m.matchedIndicatorIds)),
      links: ids.flatMap((id) => linksByDetection.get(id) ?? []),
      summary: "",
    };
    cluster.summary = describeCluster(cluster);
    clusters.push(cluster);
  }
  clusters.sort(
    (a, b) => b.lastTimestamp - a.lastTimestamp || a.clusterId.localeCompare(b.clusterId),
  );
  return clusters;
}

export function formatSpan(ms: number): string {
  if (ms < 1000) return "under a second";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Conservative, deterministic description. Never claims compromise or safety. */
export function describeCluster(c: DetectionCluster): string {
  const parts: string[] = [];
  const span = c.lastTimestamp - c.firstTimestamp;
  const where =
    c.tabIds.length === 0
      ? ""
      : c.tabIds.length === 1
        ? " in one tab"
        : ` across ${plural(c.tabIds.length, "tab")}`;
  parts.push(
    `${plural(c.detectionIds.length, "detection")} from ${plural(c.ruleIds.length, "rule")}` +
      (c.detectionIds.length > 1 ? ` within ${formatSpan(span)}` : "") +
      where +
      ".",
  );
  if (c.hostnames.length > 0) {
    const shown = c.hostnames.slice(0, 4).join(", ");
    const more = c.hostnames.length > 4 ? ` and ${c.hostnames.length - 4} more` : "";
    parts.push(`Observed traffic involved ${shown}${more}.`);
  }
  if (c.indicatorIds.length > 0) {
    parts.push(
      `${plural(c.indicatorIds.length, "documented indicator")} matched; this records contact with infrastructure described in public reporting, not what happened on the device.`,
    );
  }
  const reasons = new Set(c.links.map((l) => l.reason));
  if (reasons.size > 0) {
    const text: Record<ClusterLinkReason, string> = {
      shared_event: "the same observed requests",
      shared_indicator: "the same indicators",
      shared_hostname: "the same hostnames",
      shared_domain: "related domains",
      same_tab_window: "proximity in the same tab",
    };
    parts.push(`Grouped by ${[...reasons].map((r) => text[r]).join(", ")}.`);
  }
  parts.push(`Highest investigation priority among members: ${SEVERITY_TEXT[c.maxSeverity]}.`);
  return parts.join(" ");
}
