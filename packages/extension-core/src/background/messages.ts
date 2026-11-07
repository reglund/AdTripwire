import type { Settings, UiRequest, UiResponse } from "@adtripwire/shared";

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
    case "get_digest":
      return { type: r.type };
    case "get_alongside":
      if (r.all === undefined) return { type: "get_alongside" };
      if (typeof r.all !== "boolean") return null;
      return r.all ? { type: "get_alongside", all: true } : { type: "get_alongside" };
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
    case "export_stix": {
      if (typeof r.includeIndicators !== "boolean") return null;
      if (r.detectionIds !== undefined && !isStrArr(r.detectionIds)) return null;
      const req: Extract<UiRequest, { type: "export_stix" }> = {
        type: "export_stix",
        includeIndicators: r.includeIndicators,
      };
      if (r.detectionIds !== undefined) req.detectionIds = r.detectionIds;
      return req;
    }
    case "export_siem": {
      if (r.detectionIds !== undefined && !isStrArr(r.detectionIds)) return null;
      const req: Extract<UiRequest, { type: "export_siem" }> = { type: "export_siem" };
      if (r.detectionIds !== undefined) req.detectionIds = r.detectionIds;
      return req;
    }
    case "export_handoff": {
      if (r.profile !== "default" && r.profile !== "strict") return null;
      if (r.detectionIds !== undefined && !isStrArr(r.detectionIds)) return null;
      const req: Extract<UiRequest, { type: "export_handoff" }> = {
        type: "export_handoff",
        profile: r.profile,
      };
      if (r.detectionIds !== undefined) req.detectionIds = r.detectionIds;
      return req;
    }
    case "import_indicator_set": {
      if (r.format !== "adtripwire" && r.format !== "stix") return null;
      if (typeof r.text !== "string" || r.text.length === 0 || r.text.length > 20 * 1024 * 1024)
        return null;
      if (typeof r.enabled !== "boolean") return null;
      return { type: "import_indicator_set", format: r.format, text: r.text, enabled: r.enabled };
    }
    case "remove_indicator_set":
      return typeof r.setId === "string" && r.setId.length <= 128
        ? { type: "remove_indicator_set", setId: r.setId }
        : null;
    case "set_indicator_set_enabled":
      return typeof r.setId === "string" && r.setId.length <= 128 && typeof r.enabled === "boolean"
        ? { type: "set_indicator_set_enabled", setId: r.setId, enabled: r.enabled }
        : null;
    case "set_detection_note":
      return typeof r.detectionId === "string" &&
        r.detectionId.length <= 64 &&
        typeof r.note === "string" &&
        r.note.length <= 4000
        ? { type: "set_detection_note", detectionId: r.detectionId, note: r.note }
        : null;
    case "get_timeline": {
      const req: Extract<UiRequest, { type: "get_timeline" }> = { type: "get_timeline" };
      if (r.tabId !== undefined) {
        if (typeof r.tabId !== "number" || !Number.isInteger(r.tabId)) return null;
        req.tabId = r.tabId;
      }
      if (r.since !== undefined) {
        if (typeof r.since !== "number" || !Number.isFinite(r.since)) return null;
        req.since = r.since;
      }
      if (r.limit !== undefined) {
        if (
          typeof r.limit !== "number" ||
          !Number.isInteger(r.limit) ||
          r.limit < 1 ||
          r.limit > 5000
        )
          return null;
        req.limit = r.limit;
      }
      return req;
    }
    case "get_clusters":
      return { type: "get_clusters" };
    case "get_cluster":
      return typeof r.clusterId === "string" && /^c-[0-9a-f]{8}$/.test(r.clusterId)
        ? { type: "get_cluster", clusterId: r.clusterId }
        : null;
    case "get_assist_package": {
      const req: Extract<UiRequest, { type: "get_assist_package" }> = {
        type: "get_assist_package",
      };
      if (r.detectionId !== undefined) {
        if (typeof r.detectionId !== "string" || r.detectionId.length > 64) return null;
        req.detectionId = r.detectionId;
      }
      if (r.clusterId !== undefined) {
        if (typeof r.clusterId !== "string" || !/^c-[0-9a-f]{8}$/.test(r.clusterId)) return null;
        req.clusterId = r.clusterId;
      }
      if ((req.detectionId === undefined) === (req.clusterId === undefined)) return null;
      if (r.language !== undefined) {
        if (r.language !== "en" && r.language !== "nb") return null;
        req.language = r.language;
      }
      return req;
    }
    case "update_assist_settings": {
      if (!r.patch || typeof r.patch !== "object") return null;
      const patch: Partial<Settings["assist"]> = {};
      for (const [k, v] of Object.entries(r.patch as Record<string, unknown>)) {
        if (k === "enabled" && typeof v === "boolean") patch.enabled = v;
        else if (
          k === "port" &&
          typeof v === "number" &&
          Number.isInteger(v) &&
          v >= 1 &&
          v <= 65535
        )
          patch.port = v;
        else if (
          k === "model" &&
          typeof v === "string" &&
          /^(?:[A-Za-z0-9][A-Za-z0-9._:/-]{0,127})?$/.test(v)
        )
          patch.model = v;
        else if (k === "language" && (v === "en" || v === "nb")) patch.language = v;
        else return null;
      }
      return { type: "update_assist_settings", patch };
    }
    case "get_exposure":
      return { type: "get_exposure" };
    case "update_ui_settings": {
      if (!r.patch || typeof r.patch !== "object") return null;
      const patch: Partial<Settings["ui"]> = {};
      for (const [k, v] of Object.entries(r.patch as Record<string, unknown>)) {
        if (k === "language" && (v === "auto" || v === "en" || v === "nb")) patch.language = v;
        else return null;
      }
      return { type: "update_ui_settings", patch };
    }
    case "verify_signed_bundle":
    case "activate_signed_bundle":
      return typeof r.text === "string" && r.text.length > 0 && r.text.length <= 20 * 1024 * 1024
        ? { type: r.type, text: r.text }
        : null;
    case "remove_signed_bundle":
      return { type: "remove_signed_bundle" };
    default:
      return null;
  }
}

export const ok = (data: unknown): UiResponse => ({ ok: true, data });
export const fail = (error: string): UiResponse => ({ ok: false, error });
