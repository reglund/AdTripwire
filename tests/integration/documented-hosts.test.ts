import { describe, expect, it } from "vitest";
import {
  OUTCOMES_MAX,
  documentedMatcher,
  outcomeRecorder,
  outcomeText,
} from "../../scripts/lib/documented-hosts.mjs";
import { contactsOf, loadRuns, outcomesOf } from "../../scripts/lib/exposure-runs.mjs";
import { buildIndex, renderHtml } from "../../scripts/observatory-build.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const IND = [
  {
    id: "x-1",
    indicator: "tracker.test",
    indicatorType: "domain",
    classification: "surveillance",
    enabled: true,
  },
  {
    id: "x-2",
    indicator: "exact.bad.test",
    indicatorType: "hostname",
    classification: "malicious",
    enabled: true,
  },
  {
    id: "x-3",
    indicator: "corp.test",
    indicatorType: "domain",
    classification: "contextual",
    enabled: true,
  },
  {
    id: "x-4",
    indicator: "off.test",
    indicatorType: "domain",
    classification: "malicious",
    enabled: false,
  },
  {
    id: "x-5",
    indicator: "old.test",
    indicatorType: "domain",
    classification: "malicious",
    enabled: true,
    validTo: "2026-01-01",
  },
];
const NOW = Date.parse("2026-11-08T00:00:00Z");

describe("documentedMatcher", () => {
  const m = documentedMatcher({ indicators: IND, now: NOW });
  it("matches domains on a label boundary and hostnames exactly", () => {
    expect(m("tracker.test")).toBe("x-1");
    expect(m("events.tracker.test")).toBe("x-1");
    expect(m("EVENTS.tracker.test.")).toBe("x-1");
    expect(m("nottracker.test")).toBeNull();
    expect(m("exact.bad.test")).toBe("x-2");
    expect(m("sub.exact.bad.test")).toBeNull();
  });
  it("ignores contextual, disabled and expired indicators", () => {
    expect(m("corp.test")).toBeNull();
    expect(m("off.test")).toBeNull();
    expect(m("old.test")).toBeNull();
  });
  it("loads the bundled set and matches a documented host from the reports", () => {
    const b = documentedMatcher({ now: NOW });
    expect(b("events.myweb3id.io")).toMatch(/^adf-/);
    expect(b("www.example.com")).toBeNull();
  });
});

describe("outcomeRecorder", () => {
  const m = documentedMatcher({ indicators: IND, now: NOW });
  it("counts requests, statuses, sizes, redirects and failures for documented hosts only", () => {
    const r = outcomeRecorder(m);
    r.request("https://events.tracker.test/cookie-sync/x?userid=SECRET");
    r.request("https://events.tracker.test/cookie-sync/x?userid=SECRET2");
    r.request("https://exact.bad.test/getAd?id=1");
    r.request("https://cdn.example/x.js");
    r.response("https://events.tracker.test/cookie-sync/x?userid=SECRET", 302, {
      bytes: 0,
      location: "https://mc.yandex.ru/sync?uid=SECRET",
    });
    r.redirect("https://events.tracker.test/a", "https://ads.other.example/b");
    r.failure("https://exact.bad.test/getAd?id=1", "net::ERR_NAME_NOT_RESOLVED");
    r.failure("https://exact.bad.test/getAd?id=1", "bad <script>");
    r.response("https://cdn.example/x.js", 200);
    const rows = r.rows();
    expect(rows).toEqual([
      {
        host: "events.tracker.test",
        indicator: "x-1",
        requests: 2,
        statuses: { "302": 1, "3xx": 1 },
        failures: {},
        maxBytes: 0,
        redirectTo: ["other.example", "yandex.ru"],
      },
      {
        host: "exact.bad.test",
        indicator: "x-2",
        requests: 1,
        statuses: {},
        failures: { "net::ERR_NAME_NOT_RESOLVED": 1, unknown: 1 },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("SECRET");
    expect(outcomeText(rows[0])).toBe(
      "2 request(s): HTTP 302, HTTP 3xx; largest declared size 0 B; redirected to other.example, yandex.ru",
    );
    expect(outcomeText({ ...rows[1], requests: 3 })).toBe(
      "3 request(s): failed: net::ERR_NAME_NOT_RESOLVED, unknown; 1 without a recorded end",
    );
  });
  it("caps rows", () => {
    const r = outcomeRecorder(() => "x-1");
    for (let i = 0; i < OUTCOMES_MAX + 5; i++) r.request(`https://h${i}.tracker.test/`);
    expect(r.rows()).toHaveLength(OUTCOMES_MAX);
  });
});

describe("documentedOutcomes in runs", () => {
  const OK = {
    host: "events.tracker.test",
    indicator: "x-1",
    requests: 1,
    statuses: { "200": 1 },
    failures: {},
    maxBytes: 43,
  };
  const run = (outcomes: unknown) => ({
    date: "2026-11-08",
    browser: "chromium",
    variant: "chromium",
    results: [{ site: "a.example", detections: [], documentedOutcomes: outcomes }],
  });
  it("loads valid rows and rejects malformed ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "adtripwire-outcomes-"));
    try {
      const put = (f: string, o: unknown) => writeFileSync(join(dir, f), JSON.stringify(run(o)));
      put("ok.json", [OK]);
      put("notarr.json", OK);
      put("host.json", [{ ...OK, host: "a b" }]);
      put("status.json", [{ ...OK, statuses: { "200": 0 } }]);
      put("fail.json", [{ ...OK, failures: { "<x>": 1 } }]);
      put("bytes.json", [{ ...OK, maxBytes: -1 }]);
      put("redir.json", [{ ...OK, redirectTo: ["https://x/"] }]);
      put(
        "many.json",
        Array.from({ length: OUTCOMES_MAX + 1 }, () => OK),
      );
      expect(loadRuns(dir).map((r: { file: string }) => r.file)).toEqual(["ok.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("lists outcomes in the index and page without counting them as contacts", () => {
    const r = { file: "x.json", ...run([OK]) };
    expect(outcomesOf([r])).toHaveLength(1);
    expect(contactsOf([r])).toEqual([]);
    const index = buildIndex([r], { generatedAt: "2026-11-08T12:00:00.000Z" });
    expect(index.outcomes).toEqual([
      { date: "2026-11-08", rig: "rig-1", variant: "chromium", site: "a.example", ...OK },
    ]);
    const html = renderHtml(index);
    expect(html).toContain("How requests to documented hosts ended");
    expect(html).toContain("1 request(s): HTTP 200; largest declared size 43 B");
  });
});
