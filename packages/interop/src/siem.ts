/**
 * SIEM export as Elastic Common Schema (ECS 8.11) NDJSON: one JSON document per line.
 *
 * Detections become `event.kind: "alert"` documents; supporting events become
 * `event.kind: "event"` documents. Only sanitized fields are used (destination hostname, path
 * pattern, query parameter NAMES); query values never exist in the input and never appear here.
 * Frame/top-document hostnames are deliberately omitted (browsing-history minimisation).
 */
import type {
  Confidence,
  Detection,
  IndicatorSet,
  NormalizedEvent,
  SensorCapabilities,
  Severity,
} from "@adtripwire/shared";
import { applyRedaction, indexIndicators, pathOnly } from "./common.js";
import type { RedactionChoice } from "./common.js";

export const ECS_VERSION = "8.11.0";

export interface EcsExportOptions extends RedactionChoice {
  productVersion: string;
  rulesetVersion: string;
  browser: SensorCapabilities;
  /** Export time, used for `event.created`. */
  now: Date;
  /** When given, matched indicators are expanded into `threat.indicator` / `threat.enrichments`. */
  indicatorSets?: readonly IndicatorSet[];
}

export const ECS_SEVERITY: Record<Severity, number> = {
  informational: 1,
  suspicious: 3,
  elevated: 5,
  high_priority: 7,
};

const ECS_CONFIDENCE: Record<Confidence, "Low" | "Medium" | "High"> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const iso = (t: number | Date): string => new Date(t).toISOString();

function observer(opts: EcsExportOptions): Record<string, unknown> {
  const b = opts.browser.browser;
  return {
    vendor: "AdTripwire",
    product: `AdTripwire ${b === "chromium" ? "Chromium" : b === "firefox" ? "Firefox" : "Unknown"}`,
    version: opts.productVersion,
    type: "sensor",
  };
}

function lines(docs: readonly Record<string, unknown>[]): string {
  return docs.map((d) => JSON.stringify(d) + "\n").join("");
}

/** ECS alert documents for detections (NDJSON; empty string when there are none). */
export function detectionsToEcsNdjson(
  detections: readonly Detection[],
  events: readonly NormalizedEvent[],
  opts: EcsExportOptions,
): string {
  const red = applyRedaction(detections, events, opts);
  const eventById = new Map(red.events.map((e) => [e.eventId, e] as const));
  const indicators = indexIndicators(opts.indicatorSets ?? []);
  const created = iso(opts.now);
  const docs = [...red.detections]
    .sort((a, b) => a.timestamp - b.timestamp || (a.detectionId < b.detectionId ? -1 : 1))
    .map((d) => {
      const evs = d.eventIds.map((id) => eventById.get(id)).filter((e) => e !== undefined);
      const times = evs.map((e) => e.timestamp);
      const start = times.length > 0 ? Math.min(...times) : d.firstEventTimestamp;
      const end = Math.max(start, times.length > 0 ? Math.max(...times) : d.timestamp);
      const depths = evs.map((e) => e.frameContext.depth).filter((n) => n >= 0);
      const enrichments: Record<string, unknown>[] = [];
      for (const id of [...new Set(d.matchedIndicatorIds)]) {
        const hit = indicators.get(id);
        if (!hit) continue;
        const r = hit.record;
        const isPath = r.indicatorType === "hostname_path" || r.indicatorType === "url_path";
        const name =
          r.indicatorType === "hostname_path"
            ? `${r.indicator}${pathOnly(r.pathPattern ?? "/")}`
            : r.indicatorType === "url_path"
              ? pathOnly(r.pathPattern ?? r.indicator)
              : r.indicator;
        const indicator = {
          type: isPath ? "url" : "domain-name",
          name,
          description: `${r.classification}${r.role !== undefined ? `/${r.role}` : ""}: ${r.indicatorType} indicator ${id}`,
          confidence: ECS_CONFIDENCE[r.confidence],
          provider: r.source,
          reference: r.sourceUrl,
          first_seen: `${r.firstReported}T00:00:00.000Z`,
          marking: { tlp: "CLEAR" },
        };
        enrichments.push({
          indicator,
          matched: {
            atomic: isPath ? name : r.indicator,
            field: "related.hosts",
            id,
            index: hit.setId,
            type: "indicator_match_rule",
          },
        });
      }
      const doc: Record<string, unknown> = {
        "@timestamp": iso(d.timestamp),
        ecs: { version: ECS_VERSION },
        event: {
          kind: "alert",
          category: ["network", "threat"],
          type: ["indicator", "info"],
          severity: ECS_SEVERITY[d.severity],
          risk_score: ECS_SEVERITY[d.severity] * 10,
          id: d.detectionId,
          module: "adtripwire",
          dataset: "adtripwire.detection",
          created,
          start: iso(start),
          end: iso(end),
        },
        rule: {
          id: d.ruleId,
          name: d.ruleName,
          version: d.ruleVersion,
          category: d.category,
          ruleset: opts.rulesetVersion,
        },
        message: d.summary,
        related: { hosts: [...new Set(d.subjectHostnames.map((h) => h.toLowerCase()))].sort() },
        observer: observer(opts),
        adtripwire: {
          severity: d.severity,
          confidence: d.confidence,
          confidence_rationale: d.confidenceRationale,
          significance: d.significance,
          alternative_explanations: d.alternativeExplanations,
          limitations: d.limitations,
          missing_visibility: d.missingVisibility,
          recommended_actions: d.recommendedActions,
          event_ids: d.eventIds,
          matched_indicator_ids: d.matchedIndicatorIds,
          occurrence_count: d.occurrenceCount,
          frame_depth_max: depths.length > 0 ? Math.max(...depths) : null,
          ruleset_version: opts.rulesetVersion,
          browser: opts.browser.browser,
          capabilities: opts.browser.capabilities,
        },
      };
      if (enrichments.length > 0) {
        doc["threat"] = {
          indicator: enrichments[0]!["indicator"],
          enrichments,
        };
      }
      return doc;
    });
  return lines(docs);
}

const OUTCOME: Partial<Record<NormalizedEvent["eventType"], string>> = {
  request_completed: "success",
  request_error: "failure",
};

/** ECS event documents for supporting observations (NDJSON; empty string when none). */
export function eventsToEcsNdjson(
  events: readonly NormalizedEvent[],
  opts: EcsExportOptions,
): string {
  const red = applyRedaction([], events, opts);
  const created = iso(opts.now);
  const docs = [...red.events]
    .sort((a, b) => a.timestamp - b.timestamp || (a.eventId < b.eventId ? -1 : 1))
    .map((e) => {
      const dest = e.destination;
      const host = dest.hostname.toLowerCase();
      const url: Record<string, unknown> = {
        domain: host,
        path: pathOnly(dest.pathPattern),
        scheme: dest.scheme,
      };
      if (dest.port !== undefined) url["port"] = dest.port;
      const http: Record<string, unknown> = {};
      if (e.method !== undefined) http["request"] = { method: e.method.toUpperCase() };
      const response: Record<string, unknown> = {};
      if (e.statusCode !== undefined) response["status_code"] = e.statusCode;
      if (e.responseSizeIfObservable !== undefined) response["bytes"] = e.responseSizeIfObservable;
      if (Object.keys(response).length > 0) http["response"] = response;
      const event: Record<string, unknown> = {
        kind: "event",
        category: ["network", "web"],
        type: ["info"],
        action: e.eventType,
        id: e.eventId,
        module: "adtripwire",
        dataset: "adtripwire.observation",
        created,
      };
      const outcome = OUTCOME[e.eventType];
      if (outcome !== undefined) event["outcome"] = outcome;
      const fc = e.frameContext;
      const adtripwire: Record<string, unknown> = {
        sensor: e.sensor,
        request_status: e.requestStatus,
        evidence_quality: e.evidenceQuality,
        matched_indicator_ids: e.matchedIndicators,
        matched_rule_ids: e.matchedRules,
        observation_limitations: e.observationLimitations,
        query_param_names: dest.queryParamNames,
        path_redacted: dest.redacted,
        frame: {
          id: fc.frameId,
          parent_id: fc.parentFrameId,
          depth: fc.depth,
          ...(fc.thirdParty !== undefined ? { third_party: fc.thirdParty } : {}),
        },
      };
      if (e.resourceType !== undefined) adtripwire["resource_type"] = e.resourceType;
      if (e.fromCache !== undefined) adtripwire["from_cache"] = e.fromCache;
      if (e.correlationId !== undefined) adtripwire["correlation_id"] = e.correlationId;
      if (e.responseInspection !== undefined) {
        const ri = e.responseInspection;
        adtripwire["response_inspection"] = {
          observed_bytes: ri.observedBytes,
          truncated: ri.truncated,
          text_decodable: ri.textDecodable,
          markers: ri.markers,
          ...(ri.contentType !== undefined ? { content_type: ri.contentType } : {}),
        };
      }
      if (e.pageSignal !== undefined) adtripwire["page_signal"] = { kind: e.pageSignal.kind };
      const doc: Record<string, unknown> = {
        "@timestamp": iso(e.timestamp),
        ecs: { version: ECS_VERSION },
        event,
        url,
        network: {
          protocol:
            dest.scheme === "ws" || dest.scheme === "wss"
              ? "websocket"
              : dest.scheme === "other"
                ? "unknown"
                : "http",
        },
        related: { hosts: [host] },
        observer: observer(opts),
        adtripwire,
      };
      if (Object.keys(http).length > 0) doc["http"] = http;
      return doc;
    });
  return lines(docs);
}
