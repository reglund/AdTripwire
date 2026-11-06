/**
 * Observatory data library and static site build (scripts/lib/exposure-runs.mjs,
 * scripts/observatory-build.mjs). Runs against synthetic run JSON in temp directories.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRuns, scrub, variantSlug } from "../../scripts/lib/exposure-runs.mjs";
import {
  MAX_CALENDAR_DAYS,
  build,
  buildIndex,
  dayRange,
  esc,
  renderHtml,
} from "../../scripts/observatory-build.mjs";
import {
  compareRuns,
  flagsForSlug,
  formatComparison,
  loadedAllowance,
} from "../../scripts/observatory-reproduce.mjs";

type Det = { ruleId: string; severity: string; hostnames?: string[] };
type Row = {
  site: string;
  loaded: boolean;
  consent: string | null;
  article: boolean;
  events: number;
  thirdPartyDomains: number;
  detections: Det[];
  error?: string;
};

const row = (site: string, detections: Det[] = [], extra: Partial<Row> = {}): Row => ({
  site,
  loaded: true,
  consent: null,
  article: true,
  events: 100,
  thirdPartyDomains: 20,
  detections,
  ...extra,
});

const run = (over: Record<string, unknown> = {}, results: Row[] = [row("a.example")]) => ({
  date: "2026-11-02",
  browser: "chromium",
  device: null,
  sites: "tests/fixtures/exposure-sites.txt",
  etpOff: false,
  seconds: 60,
  totals: { sites: results.length, loaded: results.length, detections: [] },
  results,
  ...over,
});

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "adtripwire-observatory-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const KNOWN: Det = {
  ruleId: "known_infra.surveillance_contact",
  severity: "suspicious",
  hostnames: ["tracker.example"],
};
const STRONG: Det = {
  ruleId: "correlation.adfection_chain",
  severity: "high_priority",
  hostnames: ["tracker.example"],
};

describe("loadRuns", () => {
  it("skips malformed files, non-run JSON and evidence exports, and sorts by date and variant", () => {
    const d = tmp();
    writeFileSync(join(d, "2026-11-03-chromium.json"), JSON.stringify(run({ date: "2026-11-03" })));
    writeFileSync(join(d, "2026-11-02-firefox.json"), JSON.stringify(run({ browser: "firefox" })));
    writeFileSync(join(d, "2026-11-02-chromium.json"), JSON.stringify(run()));
    writeFileSync(join(d, "broken.json"), "{ not json");
    writeFileSync(join(d, "other.json"), JSON.stringify({ hello: "world" }));
    writeFileSync(join(d, "nodate.json"), JSON.stringify({ browser: "firefox", results: [] }));
    writeFileSync(join(d, "2026-11-02-chromium.evidence.json"), JSON.stringify(run()));
    writeFileSync(join(d, "notes.txt"), "x");
    const runs = loadRuns(d);
    expect(runs.map((r: { file: string }) => r.file)).toEqual([
      "2026-11-02-chromium.json",
      "2026-11-02-firefox.json",
      "2026-11-03-chromium.json",
    ]);
  });

  it("skips runs whose date is not a real YYYY-MM-DD day", () => {
    const dir = tmp();
    const put = (f: string, date: unknown) =>
      writeFileSync(join(dir, f), JSON.stringify(run({ date })));
    put("a.json", "2026-11-02");
    put("b.json", "2026-11-2");
    put("c.json", "2026-13-45");
    put("d.json", "2026-02-30");
    put("e.json", "<b>x</b>");
    put("f.json", 20261102);
    expect(loadRuns(dir).map((r: { date: string }) => r.date)).toEqual(["2026-11-02"]);
  });

  it("returns an empty list for a missing directory", () => {
    expect(loadRuns(join(tmp(), "missing"))).toEqual([]);
  });
});

describe("variantSlug", () => {
  it("covers the daily variants and the on-demand site lists", () => {
    expect(variantSlug(run())).toBe("chromium");
    expect(variantSlug(run({ browser: "firefox" }))).toBe("firefox");
    expect(variantSlug(run({ device: "Pixel 5" }))).toBe("chromium-pixel-5");
    expect(variantSlug(run({ device: "iPhone 15" }))).toBe("chromium-iphone-15");
    expect(
      variantSlug(
        run({ browser: "firefox", etpOff: true, sites: "tests/fixtures/yandex-ad-sites.txt" }),
      ),
    ).toBe("firefox-etp-off-yandex-ad-sites");
    expect(variantSlug(run({ mobile: true }))).toBe("chromium-mobile");
  });
});

describe("scrub", () => {
  const id = { home: "/home/rigger", user: "rigger" };

  it("removes the home path and user name from nested strings and leaves other values alone", () => {
    const input = {
      sites: "/home/rigger/git/AdTripwire/tests/fixtures/x.txt",
      n: 42,
      ok: true,
      none: null,
      results: [
        {
          error: "ENOENT: /home/rigger/snap/firefox/common/profile and /rigger/tmp",
          list: ["/home/rigger", "C:\\Users\\rigger\\x"],
        },
      ],
    };
    const out = scrub(input, id);
    expect(JSON.stringify(out)).not.toContain("/home/rigger");
    expect(out.sites).toBe("~/git/AdTripwire/tests/fixtures/x.txt");
    // a bare user name is not a path rule: a /rigger/ URL path stays as observed
    expect(out.results[0].error).toBe("ENOENT: ~/snap/firefox/common/profile and /rigger/tmp");
    expect(out.results[0].list).toEqual(["~", "C:\\Users\\rigger\\x"]);
    expect(out.n).toBe(42);
    expect(out.ok).toBe(true);
    expect(out.none).toBeNull();
    // deep copy: the input is not modified
    expect(input.sites).toContain("/home/rigger");
  });

  it("leaves a bare user name in URL paths alone", () => {
    expect(scrub("https://news.example/rigger/story", id)).toBe(
      "https://news.example/rigger/story",
    );
  });

  it("does not touch words that merely contain the user name", () => {
    expect(scrub("riggers and rigger.example.test", id)).toBe("riggers and rigger.example.test");
  });
});

describe("renderHtml", () => {
  const evil = [
    run({}, [
      row('<img src=x onerror="alert(1)">&co.example', [
        { ...KNOWN, hostnames: ["a<b>.example", "x&y.example"] },
      ]),
    ]),
  ].map((r, i) => ({ file: `evil-${i}.json`, variant: "chromium", ...r }));

  it("escapes markup and ampersands in site names and hostnames", () => {
    const html = renderHtml(buildIndex(evil));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("a<b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;co.example");
    expect(html).toContain("a&lt;b&gt;.example");
    expect(html).toContain("x&amp;y.example");
    expect(html).not.toMatch(/<script/i);
    expect(esc(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });

  it("contains none of the forbidden words, with and without data", () => {
    const runs = [
      { file: "a.json", variant: "chromium", ...run({}, [row("a.example", [KNOWN, STRONG])]) },
      {
        file: "b.json",
        variant: "chromium / Pixel 5",
        ...run({ date: "2026-11-04", device: "Pixel 5" }, [row("b.example")]),
      },
    ];
    for (const html of [renderHtml(buildIndex(runs)), renderHtml(buildIndex([]))])
      expect(html).not.toMatch(/\b(safe|clean|infected|spied)\b/i);
  });

  it("never treats a value from a run file as raw HTML", () => {
    const evil = JSON.parse(
      JSON.stringify(run({}, [row("x.example", [KNOWN], {})])).replace(
        '"site":"x.example"',
        '"site":{"html":"<b>x</b>"}',
      ),
    );
    expect(evil.results[0].site).toEqual({ html: "<b>x</b>" });
    const html = renderHtml(buildIndex([{ file: "e.json", variant: "chromium", ...evil }]));
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("[object Object]");
  });

  it("draws the host grid with contact, no-contact and no-run cells", () => {
    const runs = [
      { file: "a.json", variant: "chromium", ...run({}, [row("a.example", [KNOWN])]) },
      { file: "b.json", variant: "firefox", ...run({ date: "2026-11-03", browser: "firefox" }) },
      { file: "c.json", variant: "chromium", ...run({ date: "2026-11-05" }) },
    ];
    const html = renderHtml(buildIndex(runs));
    expect(html).toContain('title="2026-11-02: contact"');
    expect(html).toContain('title="2026-11-03: run without contact"');
    expect(html).toContain('title="2026-11-04: no run"');
    expect(html).toContain("--date=2026-11-05 --variant=chromium --from=");
  });
});

describe("dayRange", () => {
  it("lists every day inclusive and keeps only the newest MAX_CALENDAR_DAYS", () => {
    expect(dayRange("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(dayRange("x", "2026-03-02")).toEqual([]);
    const long = dayRange("2020-01-01", "2026-11-05");
    expect(MAX_CALENDAR_DAYS).toBe(400);
    expect(long).toHaveLength(400);
    expect(long[long.length - 1]).toBe("2026-11-05");
    expect(long[0]).toBe("2025-10-02");
  });
});

describe("buildIndex", () => {
  it("counts contacts and strong contacts per run and builds the host table", () => {
    const runs = [
      {
        file: "a.json",
        variant: "chromium",
        ...run({}, [
          row("a.example", [
            KNOWN,
            { ruleId: "page.hidden_iframe_after_load", severity: "suspicious" },
          ]),
          row("b.example", [STRONG]),
        ]),
      },
      { file: "b.json", variant: "firefox", ...run({ browser: "firefox", date: "2026-11-03" }) },
    ];
    const idx = buildIndex(runs, { generatedAt: "2026-11-05T00:00:00.000Z" });
    expect(idx.schemaVersion).toBe(1);
    expect(idx.period).toMatchObject({ from: "2026-11-02", to: "2026-11-03", days: 2 });
    expect(idx.runs[0]).toMatchObject({
      file: "data/runs/2026-11-02-chromium.json",
      slug: "chromium",
      sites: 2,
      loaded: 2,
      contacts: 2,
      strong: 1,
      noisy: 1,
    });
    expect(idx.runs[1]).toMatchObject({ contacts: 0, strong: 0 });
    expect(idx.contacts).toHaveLength(2);
    expect(idx.hosts).toEqual([
      {
        host: "tracker.example",
        first: "2026-11-02",
        last: "2026-11-02",
        days: ["2026-11-02"],
        variants: ["chromium"],
        sites: ["a.example", "b.example"],
      },
    ]);
  });
});

describe("build", () => {
  it("writes every expected file, includes optional evidence and report, and scrubs the rig", () => {
    const src = tmp();
    const out = join(tmp(), "site");
    mkdirSync(join(src, "reports"));
    writeFileSync(
      join(src, "2026-11-02-chromium.json"),
      JSON.stringify(
        run({ sites: "/home/rigger/lists/own.txt" }, [
          row("a.example", [KNOWN], { error: "failed in /home/rigger/profile" }),
        ]),
      ),
    );
    writeFileSync(
      join(src, "2026-11-02-chromium.evidence.json"),
      JSON.stringify({ at: "/home/rigger/x" }),
    );
    writeFileSync(join(src, "reports", "2026-11-02-chromium.md"), "report at /home/rigger/y\n");
    writeFileSync(
      join(src, "2026-11-03-firefox.json"),
      JSON.stringify(run({ browser: "firefox", date: "2026-11-03" })),
    );

    const { index, written } = build({
      dir: src,
      out,
      identity: { home: "/home/rigger", user: "rigger" },
      generatedAt: "2026-11-05T00:00:00.000Z",
    });
    for (const f of ["index.html", "data/index.json", "data/trend.md", "data/README.md"])
      expect(existsSync(join(out, f)), f).toBe(true);
    expect(written).toEqual(
      expect.arrayContaining([
        "data/runs/2026-11-02-chromium-own.json",
        "data/runs/2026-11-02-chromium-own.evidence.json",
        "data/reports/2026-11-02-chromium-own.md",
        "data/runs/2026-11-03-firefox.json",
      ]),
    );
    for (const f of written) expect(existsSync(join(out, f))).toBe(true);
    expect(index.runs).toHaveLength(2);
    for (const f of written) {
      const text = readFileSync(join(out, f), "utf8");
      expect(text, f).not.toContain("/home/rigger");
      expect(text, f).not.toMatch(/\brigger\b/);
    }
    const published = JSON.parse(
      readFileSync(join(out, "data/runs/2026-11-02-chromium-own.json"), "utf8"),
    );
    expect(published.results[0].error).toBe("failed in ~/profile");
    expect(published.file).toBeUndefined();
    expect(published.variant).toBeUndefined();
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain(
      "data/runs/2026-11-02-chromium-own.evidence.json",
    );
  });

  it("removes data/ left over from an earlier build and refuses a directory holding .git", () => {
    const src = tmp();
    const out = join(tmp(), "site");
    writeFileSync(join(src, "2026-11-02-chromium.json"), JSON.stringify(run()));
    build({ dir: src, out, identity: { home: "/home/rigger", user: "rigger" } });
    mkdirSync(join(out, "data", "runs"), { recursive: true });
    writeFileSync(join(out, "data", "runs", "2026-10-01-gone.json"), "{}");
    build({ dir: src, out, identity: { home: "/home/rigger", user: "rigger" } });
    expect(existsSync(join(out, "data", "runs", "2026-10-01-gone.json"))).toBe(false);
    expect(existsSync(join(out, "data", "runs", "2026-11-02-chromium.json"))).toBe(true);

    mkdirSync(join(out, ".git"));
    writeFileSync(join(out, "data", "keep.txt"), "x");
    expect(() => build({ dir: src, out })).toThrow(/\.git/);
    expect(existsSync(join(out, "data", "keep.txt"))).toBe(true);
  });
});

describe("reproduce helpers", () => {
  it("allows at least one site of difference in loaded sites", () => {
    expect(loadedAllowance(5)).toBe(1);
    expect(loadedAllowance(8)).toBe(1);
    expect(loadedAllowance(30)).toBe(3);
    const mk = (n: number, loaded: number) => ({
      results: Array.from({ length: n }, (_, i) =>
        row(`s${i}.example`, [], { loaded: i < loaded }),
      ),
    });
    const c = compareRuns(mk(5, 5), mk(5, 4));
    expect(c.checks.loadedWithin).toBe(true);
    expect(compareRuns(mk(5, 5), mk(5, 3)).checks.loadedWithin).toBe(false);
    expect(formatComparison(c)).toContain("within 1 site(s)");
  });

  it("maps a legacy mobile slug to the iPhone 15 profile and still resolves devices", () => {
    expect(flagsForSlug("chromium-mobile")).toMatchObject({
      browser: "chromium",
      device: "iPhone 15",
    });
    expect(flagsForSlug("chromium-mobile-yandex-ad-sites")).toMatchObject({
      device: "iPhone 15",
      siteList: "yandex-ad-sites",
    });
    expect(flagsForSlug("chromium-pixel-5").device).toBe("Pixel 5");
    expect(flagsForSlug("firefox").device).toBe("");
  });
});
