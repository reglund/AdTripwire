import { describe, expect, it } from "vitest";
import { detectionHash, parseHash, routeTab } from "./route.js";

describe("parseHash", () => {
  it("defaults to overview", () => {
    expect(parseHash("")).toEqual({ name: "overview" });
    expect(parseHash("#nonsense")).toEqual({ name: "overview" });
  });
  it("parses tab routes", () => {
    expect(parseHash("#detections")).toEqual({ name: "detections" });
    expect(parseHash("#indicators")).toEqual({ name: "indicators" });
    expect(parseHash("#rules")).toEqual({ name: "rules" });
    expect(parseHash("#settings")).toEqual({ name: "settings" });
  });
  it("parses detection ids and round-trips them", () => {
    expect(parseHash("#detection/abc-123")).toEqual({ name: "detection", id: "abc-123" });
    expect(parseHash(detectionHash("a/b c"))).toEqual({ name: "detection", id: "a/b c" });
    expect(parseHash("#detection/")).toEqual({ name: "detections" });
  });
  it("keeps malformed escapes instead of throwing", () => {
    expect(parseHash("#detection/%E0%A4%A")).toEqual({ name: "detection", id: "%E0%A4%A" });
  });
  it("highlights the detections tab for a detail route", () => {
    expect(routeTab({ name: "detection", id: "x" })).toBe("detections");
  });
});
