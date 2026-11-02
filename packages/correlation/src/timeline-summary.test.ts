import { describe, expect, it } from "vitest";
import { describeEvent, summarizeTimeline } from "./timeline-summary.js";
import { det, ev, T0 } from "./test-fixtures.js";

describe("summarizeTimeline", () => {
  it("orders events and detections by time with offsets", () => {
    const e1 = ev({ eventId: "e1", timestamp: T0 });
    const e2 = ev({
      eventId: "e2",
      timestamp: T0 + 12_000,
      eventType: "response_inspected",
      sensor: "response-filter",
      responseInspection: {
        observedBytes: 10,
        truncated: false,
        textDecodable: true,
        markers: ["js.hidden_iframe"],
      },
    });
    const d = det({
      detectionId: "d",
      timestamp: T0 + 12_500,
      firstEventTimestamp: T0,
      eventIds: ["e1", "e2"],
      tabId: 4,
    });
    const s = summarizeTimeline([d], [e1, e2, ev({ eventId: "unrelated", timestamp: T0 + 1 })]);
    expect(s.steps.map((x) => x.kind)).toEqual(["event", "event", "detection"]);
    expect(s.steps[1]!.offsetMs).toBe(12_000);
    expect(s.durationMs).toBe(12_500);
    expect(s.tabCount).toBe(1);
    expect(s.text).toContain(
      "+12 s: script body from noas.synthetic-adfection.test inspected with 1 technique marker(s).",
    );
    expect(s.text).toContain("recorded 2 supporting event(s) and 1 detection(s)");
    expect(s.text).toMatch(/does not establish what, if anything, happened on the device/);
    expect(s.truncated).toBe(false);
  });

  it("caps steps and reports truncation", () => {
    const events = Array.from({ length: 60 }, (_, i) =>
      ev({ eventId: `e${i}`, timestamp: T0 + i * 10 }),
    );
    const d = det({
      detectionId: "d",
      eventIds: events.map((e) => e.eventId),
      timestamp: T0 + 1000,
      firstEventTimestamp: T0,
    });
    const s = summarizeTimeline([d], events);
    expect(s.steps).toHaveLength(40);
    expect(s.truncated).toBe(true);
    expect(s.text).toContain("omitted");
  });

  it("handles empty input", () => {
    const s = summarizeTimeline([], []);
    expect(s.steps).toEqual([]);
    expect(s.text).toBe("No events or detections to summarise.");
  });

  it("describes event kinds", () => {
    expect(
      describeEvent(
        ev({ eventId: "a", eventType: "request_redirected", redirectHostname: "b.test" }),
      ),
    ).toBe("request to noas.synthetic-adfection.test redirected to b.test");
    expect(
      describeEvent(
        ev({
          eventId: "p",
          sensor: "page",
          eventType: "page_signal",
          pageSignal: { kind: "hidden_iframe_inserted", targetHostname: "c2.test" },
        }),
      ),
    ).toBe("page signal hidden iframe inserted targeting c2.test");
    expect(describeEvent(ev({ eventId: "r" }))).toBe(
      "script request to noas.synthetic-adfection.test/getAd (status 200) from a depth-1 frame, third-party",
    );
  });
});
