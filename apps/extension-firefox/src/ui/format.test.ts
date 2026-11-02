import { describe, expect, it } from "vitest";
import {
  ALWAYS_CANNOT_SEE,
  capabilityLabel,
  categoryLabel,
  confidenceLabel,
  formatBytes,
  formatHostnames,
  formatSanitizedUrl,
  minutesToMs,
  monitoringPill,
  msToMinutes,
  parseBoundedInt,
  relativeTime,
  safeHttpUrl,
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
