import type { UiRequest, UiResponse } from "@adtripwire/shared";

/**
 * Strict validation of messages reaching the privileged background. Only the
 * extension's own pages may talk to it; every payload is shape-checked before use.
 */
export function isTrustedSender(
  sender: browser.runtime.MessageSender,
  extensionBaseUrl: string,
): boolean {
  if (sender.id !== browser.runtime.id) return false;
  if (!sender.url || !sender.url.startsWith(extensionBaseUrl)) return false;
  // Content scripts (none in Phase 1) would carry a tab; our pages are extension pages.
  if (sender.tab && sender.frameId !== undefined && sender.frameId !== 0) return false;
  return true;
}

/**
 * Content-script senders (optional page sensor): must be our extension, come from a tab,
 * and from a sub-frame (frameId > 0). Everything else about the payload is validated by
 * buildPageSignalEvent.
 */
export function isPageSensorSender(sender: browser.runtime.MessageSender): boolean {
  if (sender.id !== browser.runtime.id) return false;
  if (!sender.tab || typeof sender.tab.id !== "number" || sender.tab.id < 0) return false;
  if (typeof sender.frameId !== "number" || sender.frameId <= 0) return false;
  if (!sender.url || !/^https?:\/\//.test(sender.url)) return false;
  return true;
}

const isStrArr = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string") && v.length <= 1000;

export function parseUiRequest(raw: unknown): UiRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case "get_status":
    case "get_settings":
    case "delete_all_data":
    case "request_host_permission":
    case "list_rules":
      return { type: r.type };
    case "list_detections": {
      const f = r.filter;
      if (f === undefined) return { type: "list_detections" };
      if (!f || typeof f !== "object") return null;
      const fo = f as Record<string, unknown>;
      const filter: NonNullable<Extract<UiRequest, { type: "list_detections" }>["filter"]> = {};
      if (fo.categories !== undefined) {
        if (!isStrArr(fo.categories)) return null;
        filter.categories = fo.categories;
      }
      if (fo.severities !== undefined) {
        if (!isStrArr(fo.severities)) return null;
        filter.severities = fo.severities;
      }
      if (fo.confidences !== undefined) {
        if (!isStrArr(fo.confidences)) return null;
        filter.confidences = fo.confidences;
      }
      if (fo.since !== undefined) {
        if (typeof fo.since !== "number" || !Number.isFinite(fo.since)) return null;
        filter.since = fo.since;
      }
      if (fo.limit !== undefined) {
        if (
          typeof fo.limit !== "number" ||
          !Number.isInteger(fo.limit) ||
          fo.limit < 1 ||
          fo.limit > 5000
        )
          return null;
        filter.limit = fo.limit;
      }
      return { type: "list_detections", filter };
    }
    case "get_detection":
      return typeof r.detectionId === "string" && r.detectionId.length <= 64
        ? { type: "get_detection", detectionId: r.detectionId }
        : null;
    case "get_events":
      return isStrArr(r.eventIds) ? { type: "get_events", eventIds: r.eventIds } : null;
    case "update_settings": {
      if (!r.patch || typeof r.patch !== "object") return null;
      const allowed = new Set([
        "enabled",
        "responseInspectionEnabled",
        "responseInspectionMaxBytes",
        "excludeIncognito",
        "correlationWindowMs",
        "pageSensorEnabled",
        "detectionRetentionDays",
        "maxDetections",
        "maxEvents",
      ]);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.patch as Record<string, unknown>)) {
        if (!allowed.has(k)) return null;
        if (typeof v !== "boolean" && typeof v !== "number") return null;
        patch[k] = v;
      }
      return {
        type: "update_settings",
        patch: patch as Extract<UiRequest, { type: "update_settings" }>["patch"],
      };
    }
    case "export_evidence": {
      if (r.profile !== "default" && r.profile !== "strict") return null;
      if (r.detectionIds !== undefined && !isStrArr(r.detectionIds)) return null;
      const req: Extract<UiRequest, { type: "export_evidence" }> = {
        type: "export_evidence",
        profile: r.profile,
      };
      if (r.detectionIds !== undefined) req.detectionIds = r.detectionIds;
      return req;
    }
    default:
      return null;
  }
}

export const ok = (data: unknown): UiResponse => ({ ok: true, data });
export const fail = (error: string): UiResponse => ({ ok: false, error });
