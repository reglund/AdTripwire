/**
 * Turns contact-with-documented-infrastructure detections into a per-host exposure summary
 * the UI can tell as a short story: which site, which ad network's frame, which documented
 * host, what the source says it is, and how often it happened. Deterministic and
 * conservative: it never says more than the detections and the indicator records support.
 */
import type {
  Detection,
  IndicatorClassification,
  NormalizedEvent,
  Severity,
} from "@adtripwire/shared";
import { maxSeverity, SEVERITY_RANK } from "./severity.js";

export interface IndicatorInfo {
  id: string;
  indicator: string;
  classification: IndicatorClassification;
  role?: string;
  source: string;
  sourceUrl: string;
  notes?: string;
}

export interface ExposureContact {
  /** Documented host that was contacted (sanitized). */
  host: string;
  classification: IndicatorClassification;
  role?: string;
  sourceTitle: string;
  sourceUrl: string;
  indicatorNote?: string;
  indicatorIds: string[];
  firstSeen: number;
  lastSeen: number;
  /** Total observations including deduplicated re-occurrences. */
  count: number;
  /** Distinct UTC days (YYYY-MM-DD). */
  days: string[];
  /** Top-level sites where it happened. */
  sites: string[];
  /** Hostnames of the frames (ad networks) that issued the request. */
  via: string[];
  /** Path patterns requested on the documented host. */
  paths: string[];
  /** Query parameter names (never values). */
  paramNames: string[];
  maxSeverity: Severity;
  latestDetectionId: string;
}

export interface ExposureSummary {
  contacts: ExposureContact[];
  /** Detections at elevated or above, or from correlation / selective-response rules. */
  strongSignals: number;
  /** Contacts whose lastSeen falls inside the recent window. */
  recentContacts: number;
  recentHosts: number;
  windowDays: number;
}

const STRONG_RULES = /^(?:correlation\.|ad_delivery\.noas_selective_response)/;

const dayKey = (ts: number): string => new Date(ts).toISOString().slice(0, 10);
const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

export function summarizeExposure(
  detections: readonly Detection[],
  eventsById: (ids: readonly string[]) => NormalizedEvent[],
  indicators: ReadonlyMap<string, IndicatorInfo>,
  opts: { now?: number; windowDays?: number } = {},
): ExposureSummary {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? 7;
  const cutoff = now - windowDays * 86_400_000;
  const byHost = new Map<
    string,
    ExposureContact & {
      _days: Set<string>;
      _sites: Set<string>;
      _via: Set<string>;
      _paths: Set<string>;
      _params: Set<string>;
      _ids: Set<string>;
      _sev: Severity[];
    }
  >();
  let strongSignals = 0;

  for (const d of detections) {
    if (SEVERITY_RANK[d.severity] >= SEVERITY_RANK.elevated || STRONG_RULES.test(d.ruleId))
      strongSignals++;
    if (!d.ruleId.startsWith("known_infra.")) continue;
    const info = d.matchedIndicatorIds.map((id) => indicators.get(id)).find((x) => x !== undefined);
    const host = d.subjectHostnames[0] ?? info?.indicator;
    if (!host) continue;
    const events = eventsById(d.eventIds);
    let c = byHost.get(host);
    if (!c) {
      c = {
        host,
        classification: info?.classification ?? "contextual",
        ...(info?.role ? { role: info.role } : {}),
        sourceTitle: info?.source ?? "the indicator set",
        sourceUrl: info?.sourceUrl ?? "",
        ...(info?.notes ? { indicatorNote: info.notes } : {}),
        indicatorIds: [],
        firstSeen: d.firstEventTimestamp,
        lastSeen: d.timestamp,
        count: 0,
        days: [],
        sites: [],
        via: [],
        paths: [],
        paramNames: [],
        maxSeverity: d.severity,
        latestDetectionId: d.detectionId,
        _days: new Set(),
        _sites: new Set(),
        _via: new Set(),
        _paths: new Set(),
        _params: new Set(),
        _ids: new Set(),
        _sev: [],
      };
      byHost.set(host, c);
    }
    c.count += Math.max(1, d.occurrenceCount);
    c.firstSeen = Math.min(c.firstSeen, d.firstEventTimestamp);
    if (d.timestamp >= c.lastSeen) {
      c.lastSeen = d.timestamp;
      c.latestDetectionId = d.detectionId;
    }
    c._days.add(dayKey(d.firstEventTimestamp));
    c._days.add(dayKey(d.timestamp));
    c._sev.push(d.severity);
    for (const id of d.matchedIndicatorIds) c._ids.add(id);
    for (const e of events) {
      if (
        e.destination.hostname !== host &&
        !host.endsWith(`.${e.destination.hostname}`) &&
        !e.destination.hostname.endsWith(`.${host}`)
      )
        continue;
      if (e.frameContext.topHostname) c._sites.add(e.frameContext.topHostname);
      const via = e.frameContext.documentHostname;
      if (via && via !== e.frameContext.topHostname) c._via.add(via);
      c._paths.add(e.destination.pathPattern);
      for (const p of e.destination.queryParamNames) c._params.add(p);
    }
  }

  const contacts: ExposureContact[] = [...byHost.values()].map((c) => {
    const { _days, _sites, _via, _paths, _params, _ids, _sev, ...rest } = c;
    return {
      ...rest,
      days: sortedUnique(_days),
      sites: sortedUnique(_sites),
      via: sortedUnique(_via),
      paths: sortedUnique(_paths),
      paramNames: sortedUnique(_params),
      indicatorIds: sortedUnique(_ids),
      maxSeverity: maxSeverity(_sev),
    };
  });
  // Most serious class first, then most recent.
  const classRank: Record<IndicatorClassification, number> = {
    malicious: 0,
    surveillance: 1,
    contextual: 2,
  };
  contacts.sort(
    (a, b) => classRank[a.classification] - classRank[b.classification] || b.lastSeen - a.lastSeen,
  );
  const recent = contacts.filter((c) => c.lastSeen >= cutoff);
  return {
    contacts,
    strongSignals,
    recentContacts: recent.reduce((n, c) => n + c.count, 0),
    recentHosts: recent.length,
    windowDays,
  };
}

const CLASS_MEANING: Record<IndicatorClassification, string> = {
  malicious:
    "The source documents this host as part of a spyware-delivery path. Contact shows the ad path reached it; it does not by itself show that anything was delivered or installed. Preserve the evidence and consider a specialist review if you may be a target.",
  surveillance:
    "The source documents this host as infrastructure of the ad platform behind the campaign. Contact means this browser was exposed to that platform; it is not evidence of targeting or of anything reaching the device.",
  contextual: "The source lists this host as related vendor infrastructure. It adds context only.",
};

/** Plain-language story for one contact. English, like all rule content. */
export function exposureStory(c: ExposureContact): {
  headline: string;
  body: string;
  meaning: string;
} {
  const sites = c.sites.length
    ? c.sites.slice(0, 3).join(", ") + (c.sites.length > 3 ? ` and ${c.sites.length - 3} more` : "")
    : "a page";
  const via = c.via.length ? ` by an ad frame from ${c.via.slice(0, 2).join(" and ")}` : "";
  const what =
    c.paths.some((p) => /sync|match|uid/i.test(p)) ||
    c.paramNames.some((p) => /uid|user|cust/i.test(p))
      ? "an identifier sync (the ad network shared a user ID with the host)"
      : "a request";
  const times = c.count === 1 ? "once" : `${c.count} times`;
  const days = c.days.length > 1 ? ` on ${c.days.length} different days` : "";
  return {
    headline: `${c.host} was contacted ${times}${days}`,
    body: `On ${sites}, ${what} was sent to ${c.host}${via}. ${c.sourceTitle} documents this host${c.indicatorNote ? `: ${c.indicatorNote.replace(/\.$/, "")}` : ""}.`,
    meaning: CLASS_MEANING[c.classification],
  };
}

/** Sanitized, copy-ready sighting note for researchers (TLP:CLEAR). */
export function sightingText(c: ExposureContact, productVersion: string, browser: string): string {
  const lines = [
    `Sighting of documented AdFection infrastructure (TLP:CLEAR)`,
    ``,
    `Host: ${c.host} (${c.indicatorIds.join(", ")}; ${c.classification}${c.role ? `, ${c.role}` : ""})`,
    `Source: ${c.sourceTitle}${c.sourceUrl ? ` — ${c.sourceUrl}` : ""}`,
    `First seen: ${new Date(c.firstSeen).toISOString()}`,
    `Last seen: ${new Date(c.lastSeen).toISOString()}`,
    `Observations: ${c.count} on ${c.days.length} day(s): ${c.days.join(", ")}`,
    `Sites (top-level): ${c.sites.join(", ") || "not recorded"}`,
    `Issuing ad frame(s): ${c.via.join(", ") || "not recorded"}`,
    `Path(s): ${c.paths.join(", ") || "not recorded"}`,
    `Query parameter names (values never stored): ${c.paramNames.join(", ") || "none"}`,
    `Observer: AdTripwire ${productVersion}, ${browser}; passive browser sensor, no values or cookies recorded.`,
    ``,
    `This records network contact with documented infrastructure. It is not evidence of targeting or of anything delivered to a device.`,
  ];
  return lines.join("\n");
}

/** Toolbar badge for the summary: count of recent documented-host contacts, coloured by class. */
export function badgeFor(s: ExposureSummary): { text: string; color: string; title: string } {
  const recent = s.contacts.filter((c) => c.lastSeen >= Date.now() - s.windowDays * 86_400_000);
  if (s.strongSignals > 0) {
    return {
      text: "!",
      color: "#b42318",
      title: `AdTripwire: ${s.strongSignals} strong signal(s) recorded; open the dashboard to review.`,
    };
  }
  if (recent.length === 0) {
    return {
      text: "",
      color: "#4b5563",
      title: "AdTripwire: watching ad traffic; no documented infrastructure contacted recently.",
    };
  }
  const malicious = recent.some((c) => c.classification === "malicious");
  return {
    text: String(s.recentContacts > 99 ? "99+" : s.recentContacts),
    color: malicious ? "#b42318" : "#b26b00",
    title: `AdTripwire: documented infrastructure contacted ${s.recentContacts} time(s) (${recent.length} host(s)) in the last ${s.windowDays} days.`,
  };
}
