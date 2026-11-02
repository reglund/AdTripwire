import { describe, expect, it } from "vitest";
import { clusterDetections, describeCluster } from "./cluster.js";
import { det, T0 } from "./test-fixtures.js";

const opts = { windowMs: 5 * 60_000 };

describe("clusterDetections", () => {
  it("returns no clusters for no detections", () => {
    expect(clusterDetections([], opts)).toEqual([]);
  });

  it("links detections that share an event id", () => {
    const a = det({ detectionId: "a", eventIds: ["e1"], subjectHostnames: ["x.test"] });
    const b = det({
      detectionId: "b",
      eventIds: ["e1", "e2"],
      subjectHostnames: ["y.test"],
      tabId: 9,
    });
    const c = det({ detectionId: "c", eventIds: ["e9"], subjectHostnames: ["z.test"], tabId: 10 });
    const clusters = clusterDetections([a, b, c], opts);
    expect(clusters).toHaveLength(2);
    const ab = clusters.find((k) => k.detectionIds.includes("a"))!;
    expect(ab.detectionIds).toEqual(["a", "b"]);
    expect(ab.links).toEqual([{ from: "a", to: "b", reason: "shared_event", key: "e1" }]);
    expect(ab.tabIds).toEqual([9]);
  });

  it("links by indicator, hostname and registrable domain", () => {
    const a = det({
      detectionId: "a",
      matchedIndicatorIds: ["i1"],
      subjectHostnames: ["a.example.test"],
    });
    const b = det({
      detectionId: "b",
      matchedIndicatorIds: ["i1"],
      subjectHostnames: ["other.test"],
    });
    const c = det({ detectionId: "c", subjectHostnames: ["b.example.test"] });
    const d = det({ detectionId: "d", subjectHostnames: ["other.test"] });
    const clusters = clusterDetections([a, b, c, d], opts);
    expect(clusters).toHaveLength(1);
    const reasons = clusters[0]!.links.map((l) => l.reason).sort();
    expect(reasons).toEqual(["shared_domain", "shared_hostname", "shared_indicator"]);
    expect(clusters[0]!.registrableDomains).toEqual(["example.test", "other.test"]);
  });

  it("links same-tab detections only within the window", () => {
    const a = det({ detectionId: "a", timestamp: T0, tabId: 1, subjectHostnames: ["a.test"] });
    const b = det({
      detectionId: "b",
      timestamp: T0 + 60_000,
      tabId: 1,
      subjectHostnames: ["b.test"],
    });
    const c = det({
      detectionId: "c",
      timestamp: T0 + 60_000 + 6 * 60_000,
      tabId: 1,
      subjectHostnames: ["c.test"],
    });
    const clusters = clusterDetections([a, b, c], opts);
    expect(clusters.map((k) => k.detectionIds)).toEqual([["c"], ["a", "b"]]);
    expect(clusters[1]!.links[0]!.reason).toBe("same_tab_window");
  });

  it("does not link different tabs with unrelated hosts", () => {
    const a = det({ detectionId: "a", timestamp: T0, tabId: 1, subjectHostnames: ["a.test"] });
    const b = det({ detectionId: "b", timestamp: T0 + 10, tabId: 2, subjectHostnames: ["b.test"] });
    expect(clusterDetections([a, b], opts)).toHaveLength(2);
  });

  it("keeps the cluster id stable while the oldest member is retained", () => {
    const a = det({ detectionId: "a", timestamp: T0, subjectHostnames: ["a.test"] });
    const b = det({ detectionId: "b", timestamp: T0 + 1, subjectHostnames: ["a.test"] });
    const c = det({ detectionId: "c", timestamp: T0 + 2, subjectHostnames: ["a.test"] });
    const before = clusterDetections([a, b], opts)[0]!.clusterId;
    const after = clusterDetections([a, b, c], opts)[0]!.clusterId;
    expect(after).toBe(before);
    expect(clusterDetections([b, c], opts)[0]!.clusterId).not.toBe(before);
  });

  it("computes max severity and summary without verdict language", () => {
    const a = det({
      detectionId: "a",
      severity: "suspicious",
      subjectHostnames: ["a.test"],
      matchedIndicatorIds: ["i"],
    });
    const b = det({
      detectionId: "b",
      severity: "high_priority",
      subjectHostnames: ["a.test"],
      ruleId: "r2",
    });
    const k = clusterDetections([a, b], opts)[0]!;
    expect(k.maxSeverity).toBe("high_priority");
    expect(k.summary).toContain("2 detections from 2 rules");
    expect(k.summary).toContain("a.test");
    expect(k.summary).toMatch(/Highest investigation priority among members: high priority/);
    expect(k.summary).not.toMatch(/infected|spied|safe/i);
    expect(describeCluster(k)).toBe(k.summary);
  });

  it("caps the number of detections considered and is deterministic", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      det({ detectionId: `d${i}`, timestamp: T0 + i, subjectHostnames: [`h${i}.test`] }),
    );
    const c1 = clusterDetections(many, { windowMs: 1000, maxDetections: 10 });
    expect(c1).toHaveLength(10);
    expect(c1.map((k) => k.detectionIds[0])).toEqual(
      c1
        .map((k) => k.detectionIds[0])
        .sort()
        .reverse(),
    );
    expect(clusterDetections([...many].reverse(), opts)).toEqual(clusterDetections(many, opts));
  });

  it("does not chain a common domain across days unless detections are close in time", () => {
    const a = det({ detectionId: "a", timestamp: T0, subjectHostnames: ["x.ads.test"] });
    const b = det({
      detectionId: "b",
      timestamp: T0 + 2 * 60 * 60_000,
      subjectHostnames: ["y.ads.test"],
    });
    const c = det({
      detectionId: "c",
      timestamp: T0 + 3 * 24 * 60 * 60_000,
      subjectHostnames: ["z.ads.test"],
    });
    const clusters = clusterDetections([a, b, c], { windowMs: 60_000 });
    expect(clusters.map((k) => k.detectionIds)).toEqual([["c"], ["a", "b"]]);
    expect(
      clusterDetections([a, b, c], { windowMs: 60_000, infrastructureWindowMs: 60 * 60_000 }),
    ).toHaveLength(3);
    // Shared events always link.
    const d = det({
      detectionId: "d",
      timestamp: T0 + 10 * 24 * 60 * 60_000,
      eventIds: ["e1"],
      subjectHostnames: ["q.test"],
    });
    const e = det({
      detectionId: "e",
      timestamp: T0,
      eventIds: ["e1"],
      subjectHostnames: ["r.test"],
    });
    expect(clusterDetections([d, e], { windowMs: 1 })).toHaveLength(1);
  });

  it("handles 5000 detections quickly", () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      det({
        detectionId: `d${i}`,
        timestamp: T0 + i * 100,
        tabId: i % 50,
        subjectHostnames: [`h${i % 700}.test`],
        eventIds: [`e${i}`, `e${i + 1}`],
      }),
    );
    const start = performance.now();
    const clusters = clusterDetections(many, opts);
    expect(performance.now() - start).toBeLessThan(500);
    expect(clusters.length).toBeGreaterThan(0);
  });
});
