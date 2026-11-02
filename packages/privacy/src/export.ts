import type {
  Detection,
  EvidenceExport,
  IndicatorSetMeta,
  NormalizedEvent,
  ObservationLimitation,
  RedactionMetadata,
  SensorCapabilities,
} from "@adtripwire/shared";
import { redactDetection, redactEvent } from "./redact.js";
import type { RedactionProfile } from "./redact.js";

export const EXPORT_DISCLAIMER =
  "AdTripwire records observable indicators only. Absence of detections is not evidence that a device is free of spyware. Infrastructure matches describe exposure to documented infrastructure, not confirmed compromise.";

const LIMITATION_SENTENCES: Record<ObservationLimitation, string> = {
  no_response_body_access: "Response bodies could not be read for some requests.",
  response_body_truncated: "Only a prefix of some response bodies was analysed.",
  response_body_unsupported_encoding:
    "Some response bodies used an encoding that could not be analysed.",
  frame_ancestry_unavailable: "Frame ancestry was not available for some requests.",
  url_classification_unavailable:
    "Browser tracking-protection classification was not available for some requests.",
  response_size_unknown: "Response sizes were not observable for some requests.",
  from_cache: "Some responses were served from cache, so no network request was observed for them.",
  incognito_excluded: "Private browsing windows are excluded from observation.",
  sensor_restarted_during_request:
    "The sensor restarted during some requests, so those observations may be incomplete.",
  page_sensor_disabled:
    "The optional page sensor was disabled, so in-page signals (hidden frame insertion, SDK messages) were not observed.",
  response_body_skipped_budget:
    "The response body was not inspected because too many inspections were already in progress (memory budget).",
};

const FIXED_LIMITATIONS: readonly string[] = [
  "A browser extension cannot see network traffic outside the browser, such as other applications, DNS lookups, or device-level connections.",
  "A browser extension cannot inspect the device itself, so it cannot detect installed spyware, operating-system compromise, or exploits delivered outside the browser.",
  "Encrypted content is visible only where the browser exposes it to the extension; requests blocked by other extensions or the browser may not be observed.",
  "Indicator sets describe documented infrastructure as of their published date and are not exhaustive.",
];

const DEFAULT_REDACTED_FIELDS: readonly string[] = [
  "url query parameter values",
  "url fragments",
  "url credentials",
  "full urls (replaced by host, path pattern and parameter names)",
  "path segments that look like tokens or identifiers",
  "cookie values and request or response headers",
  "request and response bodies",
  "browsing history outside detections",
];

const STRICT_REDACTED_FIELDS: readonly string[] = [
  "initiator origins",
  "tab identifiers",
  "correlation identifiers (pseudonymised)",
  "hostnames not central to a detection (pseudonymised)",
  "path detail (reduced to a placeholder unless allow-listed)",
  "query parameter names that are not known identifier parameters",
];

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function collectEventHostnames(events: NormalizedEvent[]): Set<string> {
  const hosts = new Set<string>();
  const add = (h: string | undefined) => {
    if (h !== undefined && h.length > 0) hosts.add(h.toLowerCase());
  };
  for (const e of events) {
    add(e.destination.hostname);
    add(e.redirectHostname);
    add(e.frameContext.documentHostname);
    add(e.frameContext.topHostname);
    e.frameContext.ancestorHostnames.forEach(add);
  }
  return hosts;
}

export function buildEvidenceExport(input: {
  productVersion: string;
  browser: SensorCapabilities;
  rulesetVersion: string;
  indicatorSets: IndicatorSetMeta[];
  detections: Detection[];
  events: NormalizedEvent[];
  profile: RedactionProfile;
  now?: Date;
  salt?: string;
}): EvidenceExport {
  const { profile } = input;
  const salt = input.salt !== undefined && input.salt.length > 0 ? input.salt : randomSalt();

  const keepHostnames = new Set<string>();
  for (const d of input.detections)
    for (const h of d.subjectHostnames) keepHostnames.add(h.toLowerCase());

  const options = {
    keepHostnames,
    salt,
    extraHostnames: collectEventHostnames(input.events),
  };

  const limitations = new Set<string>(FIXED_LIMITATIONS);
  for (const e of input.events) {
    for (const l of e.observationLimitations) {
      limitations.add(LIMITATION_SENTENCES[l] ?? `Observation limitation: ${String(l)}.`);
    }
  }

  const strict = profile === "strict";
  const redaction: RedactionMetadata = {
    profile,
    redactedFields: [...DEFAULT_REDACTED_FIELDS, ...(strict ? STRICT_REDACTED_FIELDS : [])].sort(),
    hostnamesPseudonymised: strict,
    note: strict
      ? "Strict profile: hostnames not central to a detection are replaced by salted pseudonyms; the salt is not included in this export."
      : "Default profile: sensitive values are never recorded; hostnames are shown as observed.",
  };

  return {
    schema: "adtripwire.evidence-export",
    schemaVersion: "1.0.0",
    productVersion: input.productVersion,
    exportedAt: (input.now ?? new Date()).toISOString(),
    browser: structuredClone(input.browser),
    rulesetVersion: input.rulesetVersion,
    indicatorSets: input.indicatorSets.map((s) => ({
      id: s.id,
      version: s.version,
      asOf: s.asOf,
      license: s.license,
    })),
    detections: input.detections.map((d) => redactDetection(d, profile, options)),
    events: input.events.map((e) => redactEvent(e, profile, options)),
    visibilityLimitations: Array.from(limitations).sort(),
    redaction,
    disclaimer: EXPORT_DISCLAIMER,
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Stable JSON (sorted object keys, 2-space indentation). */
export function serializeExport(e: EvidenceExport): string {
  return JSON.stringify(sortKeys(e), null, 2);
}
