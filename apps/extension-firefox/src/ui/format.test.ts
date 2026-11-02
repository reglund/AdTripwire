import { describe, expect, it } from "vitest";
import {
  ALWAYS_CANNOT_SEE,
  capabilityLabel,
  categoryLabel,
  confidenceLabel,
  describePageSignal,
  formatBytes,
  formatHostnames,
  formatMs,
  formatSanitizedUrl,
  metricRows,
  minutesToMs,
  missingCapabilitiesText,
  monitoringPill,
  msToMinutes,
  pageSignalLabel,
  parseBoundedInt,
  relativeTime,
  safeHttpUrl,
  sensorLabel,
  severityLabel,
  summarizeVisibility,
} from "./format.js";

describe("labels", () => {
  it("maps severities to the required labels", () => {
    expect(severityLabel("informational")).toBe("Informational");
    expect(severityLabel("suspicious")).toBe("Suspicious");
    expect(severityLabel("elevated")).toBe("Elevated");
    expect(severityLabel("high_priority")).toBe("High priority");
  });
  it("humanizes unknown values instead of failing", () => {
    expect(severityLabel("new_level")).toBe("New level");
    expect(categoryLabel("something_else")).toBe("Something else");
  });
  it("labels confidence, categories and capabilities", () => {
    expect(confidenceLabel("medium")).toBe("Medium");
    expect(categoryLabel("ad_delivery_behaviour")).toBe("Ad delivery behaviour");
    expect(capabilityLabel("response_body_inspection")).toBe("Script body inspection");
  });
});

describe("relativeTime", () => {
  const now = 1_700_000_000_000;
  it("handles recent and skewed timestamps", () => {
    expect(relativeTime(now - 5_000, now)).toBe("just now");
    expect(relativeTime(now + 5_000, now)).toBe("just now");
  });
  it("uses minutes, hours and days with correct plurals", () => {
    expect(relativeTime(now - 60_000, now)).toBe("1 minute ago");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(relativeTime(now - 3_600_000, now)).toBe("1 hour ago");
    expect(relativeTime(now - 5 * 3_600_000, now)).toBe("5 hours ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2 days ago");
  });
  it("falls back to an ISO date for old timestamps", () => {
    expect(relativeTime(now - 90 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatters", () => {
  it("formats sanitized URLs with parameter names only", () => {
    expect(
      formatSanitizedUrl({
        scheme: "https",
        hostname: "ads.example.net",
        pathPattern: "/getAd",
        queryParamNames: ["a", "b"],
        redacted: false,
      }),
    ).toBe("https://ads.example.net/getAd?a&b");
    expect(
      formatSanitizedUrl({
        scheme: "http",
        hostname: "h.example",
        port: 8080,
        pathPattern: "/",
        queryParamNames: [],
        redacted: false,
      }),
    ).toBe("http://h.example:8080/");
  });
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(-1)).toBe("unknown");
  });
  it("summarizes hostnames", () => {
    expect(formatHostnames([])).toBe("none recorded");
    expect(formatHostnames(["a", "b"])).toBe("a, b");
    expect(formatHostnames(["a", "b", "c", "d", "e"])).toBe("a, b, c +2 more");
  });
  it("converts minutes and milliseconds", () => {
    expect(minutesToMs(5)).toBe(300_000);
    expect(msToMinutes(300_000)).toBe(5);
  });
});

describe("parseBoundedInt", () => {
  it("accepts whole numbers in range", () => {
    expect(parseBoundedInt(" 7 ", 1, 365)).toBe(7);
  });
  it("rejects out-of-range, fractional, empty and non-numeric input", () => {
    expect(parseBoundedInt("0", 1, 365)).toBeNull();
    expect(parseBoundedInt("366", 1, 365)).toBeNull();
    expect(parseBoundedInt("1.5", 1, 365)).toBeNull();
    expect(parseBoundedInt("", 1, 365)).toBeNull();
    expect(parseBoundedInt("-3", 1, 365)).toBeNull();
    expect(parseBoundedInt("1e3", 1, 5000)).toBeNull();
  });
});

describe("safeHttpUrl", () => {
  it("only permits http(s)", () => {
    expect(safeHttpUrl("https://example.org/a")).toBe("https://example.org/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});

describe("monitoringPill", () => {
  it("prioritises missing permission", () => {
    expect(monitoringPill({ monitoring: true, hostPermissionGranted: false })).toBe("permission");
    expect(monitoringPill({ monitoring: false, hostPermissionGranted: true })).toBe("paused");
    expect(monitoringPill({ monitoring: true, hostPermissionGranted: true })).toBe("active");
  });
});

describe("summarizeVisibility", () => {
  it("reports absent capabilities as limitations and always includes the fixed limits", () => {
    const v = summarizeVisibility({ capabilities: ["request_metadata"] });
    expect(v.canSee).toHaveLength(1);
    expect(v.cannotSee.length).toBeGreaterThan(ALWAYS_CANNOT_SEE.length);
    expect(v.cannotSee.some((l) => l.includes("Script contents are not inspected"))).toBe(true);
    expect(v.cannotSee).toEqual(expect.arrayContaining([...ALWAYS_CANNOT_SEE]));
  });
  it("lists nothing as not-observed for body inspection when it is available", () => {
    const v = summarizeVisibility({ capabilities: ["response_body_inspection"] });
    expect(v.cannotSee.some((l) => l.includes("Script contents are not inspected"))).toBe(false);
  });
});

describe("page sensor and metrics helpers", () => {
  it("labels the five page signal kinds and humanizes unknown kinds", () => {
    expect(pageSignalLabel("hidden_iframe_inserted")).toBe("Hidden iframe inserted");
    expect(pageSignalLabel("postmessage_sdk_ready")).toBe("SDK-ready message");
    expect(pageSignalLabel("postmessage_wildcard_like")).toBe("Cross-origin typed message");
    expect(pageSignalLabel("script_inserted")).toBe("Late third-party script inserted");
    expect(pageSignalLabel("beacon_image_inserted")).toBe("Late 1x1 image inserted");
    expect(pageSignalLabel("future_kind")).toBe("Future kind");
  });
  it("labels sensors including the page sensor", () => {
    expect(sensorLabel("page")).toBe("Page (opt-in)");
    expect(sensorLabel("webrequest")).toBe("Web request");
    expect(sensorLabel("other_thing")).toBe("Other thing");
  });
  it("formats milliseconds", () => {
    expect(formatMs(0)).toBe("0.0 ms");
    expect(formatMs(2.46)).toBe("2.5 ms");
    expect(formatMs(120.4)).toBe("120 ms");
    expect(formatMs(1500)).toBe("1.5 s");
    expect(formatMs(-1)).toBe("unknown");
    expect(formatMs(Number.NaN)).toBe("unknown");
  });
  it("describes page signals without inventing fields", () => {
    expect(describePageSignal({ kind: "script_inserted" })).toEqual({
      label: "Late third-party script inserted",
      targetHostname: null,
      crossOrigin: false,
      timing: null,
    });
    expect(
      describePageSignal({
        kind: "hidden_iframe_inserted",
        targetHostname: "cdn.example.test",
        crossOrigin: true,
        msSinceLoad: 850,
      }),
    ).toEqual({
      label: "Hidden iframe inserted",
      targetHostname: "cdn.example.test",
      crossOrigin: true,
      timing: "850 ms after load",
    });
  });
  it("points page-sensor-only gaps at Settings and lists other gaps", () => {
    expect(missingCapabilitiesText(["page_signals"])).toBe(
      "Requires the optional page sensor (Settings).",
    );
    expect(missingCapabilitiesText(["page_signals", "frame_ancestry"])).toBe(
      "Not evaluable in this browser (missing: Page signals (opt-in sensor), Frame ancestry).",
    );
    expect(missingCapabilitiesText(["response_size"])).toBe(
      "Not evaluable in this browser (missing: Response size).",
    );
    expect(missingCapabilitiesText([])).toBe(
      "Not evaluable in this browser (missing: unspecified).",
    );
  });
  it("builds metric rows with human units", () => {
    const rows = metricRows({
      eventsObserved: 12345,
      eventsIngested: 12,
      inspections: 3,
      inspectedBytes: 2048,
      passThroughMsMean: 0.4,
      analysisMsMean: 12.6,
      ingestMsMean: 1500,
      inspectionsSkippedForBudget: 0,
      since: 0,
    });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Events observed"]).toBe("12,345");
    expect(byLabel["Bytes inspected"]).toBe("2.0 KiB");
    expect(byLabel["Mean pass-through time"]).toBe("0.4 ms");
    expect(byLabel["Mean analysis time"]).toBe("13 ms");
    expect(byLabel["Mean ingest time"]).toBe("1.5 s");
    expect(byLabel["Inspections skipped for budget"]).toBe("0");
    expect(rows).toHaveLength(8);
  });
});
