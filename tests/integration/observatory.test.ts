/**
 * Observatory data library and static site build (scripts/lib/exposure-runs.mjs,
 * scripts/observatory-build.mjs). Runs against synthetic run JSON in temp directories.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SEEN_ALONGSIDE_DISCLAIMER } from "@adtripwire/privacy";
import { sameSite } from "../../scripts/lib/registrable.mjs";
import { contactsOf, loadRuns, scrub, variantSlug } from "../../scripts/lib/exposure-runs.mjs";
import {
  ALONGSIDE_DISCLAIMER,
  MAX_CALENDAR_DAYS,
  build,
  buildAlongside,
  buildIndex,
  collapseIdLabels,
  dayRange,
  esc,
  renderHtml,
} from "../../scripts/observatory-build.mjs";
import {
  compareRuns,
  flagsForSlug,
  formatComparison,
  loadedAllowance,
  publishedPaths,
  resolveRig,
} from "../../scripts/observatory-reproduce.mjs";

type Det = { ruleId: string; severity: string; hostnames?: string[] };
type Alongside = { host: string; anchor: string; scope: string };
type Row = {
  site: string;
  loaded: boolean;
  consent: string | null;
  article: boolean;
  events: number;
  thirdPartyDomains: number;
  detections: Det[];
  error?: string;
  alongside?: Alongside[];
  thirdPartyDomainsList?: string[];
  alongsideAnchors?: number;
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

  it("drops runs with a malformed structure and never throws in contactsOf", () => {
    const dir = tmp();
    const put = (f: string, results: unknown) =>
      writeFileSync(join(dir, f), JSON.stringify(run({}, results as Row[])));
    put("ok.json", [row("a.example", [KNOWN])]);
    put("rows.json", ["x", null, 5]);
    put("nosite.json", [{ ...row("a.example"), site: 5 }]);
    put("detarr.json", [{ ...row("a.example"), detections: { ruleId: "x" } }]);
    put("rule.json", [row("a.example", [{ ruleId: 5, severity: "high_priority" } as never])]);
    put("sev.json", [row("a.example", [{ ruleId: "x" } as never])]);
    put("hosts.json", [row("a.example", [{ ...KNOWN, hostnames: "tracker.example" } as never])]);
    put("hosts2.json", [row("a.example", [{ ...KNOWN, hostnames: [1] } as never])]);
    put("nulldet.json", [row("a.example", [null as never])]);
    const runs = loadRuns(dir);
    expect(runs.map((r: { file: string }) => r.file)).toEqual(["ok.json"]);
    expect(() => contactsOf(runs)).not.toThrow();
    expect(() =>
      contactsOf([{ date: "2026-11-02", variant: "v", results: [null, { detections: [{}] }] }]),
    ).not.toThrow();
  });

  it("skips entries that are not regular files and reports them", () => {
    const dir = tmp();
    const target = join(tmp(), "real.json");
    writeFileSync(target, JSON.stringify(run()));
    symlinkSync(target, join(dir, "link.json"));
    mkdirSync(join(dir, "folder.json"));
    writeFileSync(join(dir, "good.json"), JSON.stringify(run()));
    let skipped = 0;
    const runs = loadRuns(dir, {
      onSkip: (n = 1) => {
        skipped += n;
      },
    });
    expect(runs.map((r: { file: string }) => r.file)).toEqual(["good.json"]);
    expect(skipped).toBe(2);
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
    expect(html).toContain("--date=2026-11-05 --variant=chromium --rig=rig-1 --from=");
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
      file: "data/runs/2026-11-02-rig-1-chromium.json",
      rig: "rig-1",
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
        rigs: ["rig-1"],
      },
    ]);
    expect(idx.rigs).toEqual([
      {
        rig: "rig-1",
        country: null,
        network: null,
        days: 2,
        runs: 2,
        variants: 2,
        contacts: 2,
        hosts: 1,
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
        "data/runs/2026-11-02-rig-1-chromium-own.json",
        "data/runs/2026-11-02-rig-1-chromium-own.evidence.json",
        "data/reports/2026-11-02-rig-1-chromium-own.md",
        "data/runs/2026-11-03-rig-1-firefox.json",
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
      readFileSync(join(out, "data/runs/2026-11-02-rig-1-chromium-own.json"), "utf8"),
    );
    expect(published.results[0].error).toBe("failed in ~/profile");
    expect(published.file).toBeUndefined();
    expect(published.variant).toBeUndefined();
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain(
      "data/runs/2026-11-02-rig-1-chromium-own.evidence.json",
    );
    expect(published.rig).toBe("rig-1");
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
    expect(existsSync(join(out, "data", "runs", "2026-11-02-rig-1-chromium.json"))).toBe(true);

    mkdirSync(join(out, ".git"));
    writeFileSync(join(out, "data", "keep.txt"), "x");
    expect(() => build({ dir: src, out })).toThrow(/\.git/);
    expect(existsSync(join(out, "data", "keep.txt"))).toBe(true);
  });
});

describe("build, single directory with --rig", () => {
  it("names files with the rig, attributes runs without one and keeps a valid own rig", () => {
    const src = tmp();
    const out = join(tmp(), "site");
    writeFileSync(join(src, "2026-11-02-chromium.json"), JSON.stringify(run()));
    writeFileSync(
      join(src, "2026-11-03-chromium.json"),
      JSON.stringify(run({ date: "2026-11-03", rig: "rig-x" })),
    );
    writeFileSync(
      join(src, "2026-11-04-chromium.json"),
      JSON.stringify(run({ date: "2026-11-04", rig: "Bad Name!" })),
    );
    const { index, written } = build({ dir: src, out, rig: "home-1" });
    expect(written).toEqual(
      expect.arrayContaining([
        "data/runs/2026-11-02-home-1-chromium.json",
        "data/runs/2026-11-03-rig-x-chromium.json",
        "data/runs/2026-11-04-home-1-chromium.json",
      ]),
    );
    expect(index.rigs.map((g: { rig: string }) => g.rig)).toEqual(["home-1", "rig-x"]);
    expect(
      JSON.parse(readFileSync(join(out, "data/runs/2026-11-02-home-1-chromium.json"), "utf8")).rig,
    ).toBe("home-1");
    expect(() => build({ dir: src, out, rig: "../x" })).toThrow(/invalid rig/);
  });
});

describe("build, --rigs mode", () => {
  const put = (base: string, rigDir: string, stem: string, body: unknown) => {
    mkdirSync(join(base, rigDir, "runs"), { recursive: true });
    writeFileSync(join(base, rigDir, "runs", `${stem}.json`), JSON.stringify(body));
  };
  const setup = () => {
    const rigs = tmp();
    // oslo: has rig.json and a declared rig in its runs; evidence and report next to them
    put(rigs, "oslo", "2026-11-02-chromium", run({ rig: "oslo" }, [row("a.example", [KNOWN])]));
    put(
      rigs,
      "oslo",
      "2026-11-03-firefox",
      run({ rig: "oslo", date: "2026-11-03", browser: "firefox" }),
    );
    writeFileSync(
      join(rigs, "oslo", "runs", "2026-11-02-chromium.evidence.json"),
      JSON.stringify({ at: "/home/rigger/x" }),
    );
    mkdirSync(join(rigs, "oslo", "reports"), { recursive: true });
    writeFileSync(join(rigs, "oslo", "reports", "2026-11-02-chromium.md"), "report oslo\n");
    writeFileSync(
      join(rigs, "oslo", "rig.json"),
      JSON.stringify({ rig: "oslo", country: "NO", network: "home", runs: 2 }),
    );
    // lima: no rig.json, one run without a rig field, same file name as oslo's
    put(rigs, "lima", "2026-11-02-chromium", run({}, [row("b.example", [KNOWN, STRONG])]));
    // an invalid directory name is skipped, and so is a plain file
    put(rigs, "Bad Rig", "2026-11-02-chromium", run({ rig: "bad" }));
    put(rigs, "UPPER", "2026-11-02-chromium", run());
    writeFileSync(join(rigs, "notes.txt"), "x");
    return rigs;
  };

  it("loads two rigs, names the directory for a run without rig and skips invalid names", () => {
    const rigs = setup();
    const out = join(tmp(), "site");
    const { index, written } = build({
      rigsDir: rigs,
      out,
      identity: { home: "/home/rigger", user: "rigger" },
      generatedAt: "2026-11-05T00:00:00.000Z",
    });
    expect(index.runs).toHaveLength(3);
    expect(index.runs.map((r: { rig: string }) => r.rig).sort()).toEqual(["lima", "oslo", "oslo"]);
    expect(index.rigs).toEqual([
      {
        rig: "lima",
        country: null,
        network: null,
        days: 1,
        runs: 1,
        variants: 1,
        contacts: 2,
        hosts: 1,
      },
      {
        rig: "oslo",
        country: "NO",
        network: "home",
        days: 2,
        runs: 2,
        variants: 2,
        contacts: 1,
        hosts: 1,
      },
    ]);
    expect(written).toEqual(
      expect.arrayContaining([
        "data/runs/2026-11-02-lima-chromium.json",
        "data/runs/2026-11-02-oslo-chromium.json",
        "data/runs/2026-11-02-oslo-chromium.evidence.json",
        "data/reports/2026-11-02-oslo-chromium.md",
        "data/runs/2026-11-03-oslo-firefox.json",
      ]),
    );
    expect(written.filter((f: string) => /bad|upper/i.test(f))).toEqual([]);
    expect(existsSync(join(out, "data/runs/2026-11-02-lima-chromium.evidence.json"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(out, "data/runs/2026-11-02-lima-chromium.json"), "utf8")).rig,
    ).toBe("lima");
    expect(
      readFileSync(join(out, "data/runs/2026-11-02-oslo-chromium.evidence.json"), "utf8"),
    ).toBe('{\n  "at": "~/x"\n}\n');
    expect(index.hosts[0].rigs.sort()).toEqual(["lima", "oslo"]);
  });

  it("attributes a run to its directory even when the JSON claims another rig", () => {
    const rigs = setup();
    // lima's key can only write under rigs/lima/; a run there that says rig "oslo" is lima's.
    put(rigs, "lima", "2026-11-04-chromium", run({ rig: "oslo", date: "2026-11-04" }));
    const out = join(tmp(), "site");
    const { index } = build({ rigsDir: rigs, out });
    const spoofed = index.runs.find((r: { date: string }) => r.date === "2026-11-04");
    expect(spoofed.rig).toBe("lima");
    expect(index.rigs.find((r: { rig: string }) => r.rig === "oslo").runs).toBe(2);
  });

  it("renders the Rigs table and a rig column in each table", () => {
    const rigs = setup();
    const out = join(tmp(), "site");
    build({ rigsDir: rigs, out });
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).toContain("<h2>Rigs</h2>");
    expect(html).toMatch(
      /<th>Rig<\/th><th>Country<\/th><th>Network<\/th><th class="n">Days run<\/th><th class="n">Runs<\/th><th class="n">Variants<\/th><th class="n">Contacts<\/th><th class="n">Distinct hosts<\/th>/,
    );
    expect(html).toContain("<td>oslo</td><td>NO</td><td>home</td>");
    expect(html).toContain("<td>lima</td><td>—</td><td>—</td>");
    expect(html.indexOf("<h2>Rigs</h2>")).toBeLessThan(
      html.indexOf("<h2>Browsers and devices side by side</h2>"),
    );
    expect(html).toContain("<th>Date</th><th>Rig</th><th>Variant</th><th>Site</th>");
    expect(html).toContain("<th>Rigs</th><th>Variants</th><th>Sites</th>");
    expect(html).toContain("<th>Dates</th><th>Rigs</th><th>Variants</th>");
    expect(html).toContain('<th>Rig</th><th>Variant</th><th class="n">Days run</th>');
    expect(html).toContain("declared by its owner");
    expect(html).not.toMatch(/\b(safe|clean|infected|spied)\b/i);
  });

  it("escapes rig metadata that is not a plain value", () => {
    const rigs = tmp();
    put(rigs, "evil", "2026-11-02-chromium", run({ rigCountry: "<b>", rigNetwork: "<i>" }));
    writeFileSync(
      join(rigs, "evil", "rig.json"),
      JSON.stringify({ country: "<script>", network: "<script>" }),
    );
    const out = join(tmp(), "site");
    const { index } = build({ rigsDir: rigs, out });
    expect(index.rigs[0]).toMatchObject({ rig: "evil", country: null, network: null });
    expect(readFileSync(join(out, "index.html"), "utf8")).not.toMatch(/<script|<b>|<i>/);
  });

  const SECRET = "TOPSECRET-do-not-publish";
  const allText = (root: string): string => {
    let all = "";
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else all += `${e.name}\n${readFileSync(p, "utf8")}\n`;
      }
    };
    walk(root);
    return all;
  };

  it("never follows a symbolic link: report, evidence, runs/ and rigs/<name> are ignored", () => {
    const rigs = setup();
    const outside = tmp();
    const secretFile = join(outside, "secret.txt");
    writeFileSync(secretFile, SECRET);
    const leakRuns = join(outside, "runs");
    mkdirSync(leakRuns);
    writeFileSync(
      join(leakRuns, "2026-11-02-chromium.json"),
      JSON.stringify(run({}, [row("a.example", [], { error: SECRET })])),
    );
    // lima: a symlinked report and a symlinked evidence file next to a real run
    put(rigs, "lima", "2026-11-03-firefox", run({ date: "2026-11-03", browser: "firefox" }));
    mkdirSync(join(rigs, "lima", "reports"), { recursive: true });
    symlinkSync(secretFile, join(rigs, "lima", "reports", "2026-11-03-firefox.md"));
    symlinkSync(secretFile, join(rigs, "lima", "runs", "2026-11-03-firefox.evidence.json"));
    // a symlinked run file
    symlinkSync(secretFile, join(rigs, "lima", "runs", "2026-11-04-link.json"));
    // a rig whose runs/ is a link, one whose reports/ is a link and a rig directory that is a link
    mkdirSync(join(rigs, "linkruns"));
    symlinkSync(leakRuns, join(rigs, "linkruns", "runs"));
    mkdirSync(join(outside, "rigdir"));
    symlinkSync(leakRuns, join(outside, "rigdir", "runs"));
    symlinkSync(join(outside, "rigdir"), join(rigs, "linkrig"));
    symlinkSync(secretFile, join(rigs, "oslo", "rig.json.link"));
    const out = join(tmp(), "site");
    const { index, written, skipped } = build({ rigsDir: rigs, out });
    expect(allText(out)).not.toContain(SECRET);
    expect(written.filter((f: string) => /linkruns|linkrig/.test(f))).toEqual([]);
    expect(index.rigs.map((r: { rig: string }) => r.rig)).toEqual(["lima", "oslo"]);
    expect(written).toContain("data/runs/2026-11-03-lima-firefox.json");
    expect(written).not.toContain("data/reports/2026-11-03-lima-firefox.md");
    expect(written).not.toContain("data/runs/2026-11-03-lima-firefox.evidence.json");
    // counted: Bad Rig and UPPER, notes.txt, the link run, report, evidence, runs/ link, rig link
    expect(skipped).toBeGreaterThanOrEqual(7);
    // a symlinked rigs directory is refused whole
    const viaLink = join(tmp(), "rigs-link");
    symlinkSync(rigs, viaLink);
    const out2 = join(tmp(), "site2");
    expect(build({ rigsDir: viaLink, out: out2 }).index.runs).toEqual([]);
    expect(allText(out2)).not.toContain(SECRET);
  });

  it("skips files over 5 MB and keeps the others", () => {
    const rigs = setup();
    const big = "x".repeat(5 * 1024 * 1024 + 1);
    writeFileSync(join(rigs, "oslo", "reports", "2026-11-02-chromium.md"), big);
    writeFileSync(join(rigs, "oslo", "runs", "2026-11-02-chromium.evidence.json"), big);
    writeFileSync(join(rigs, "lima", "runs", "2026-11-05-firefox.json"), big);
    const out = join(tmp(), "site");
    const { index, written, skipped } = build({ rigsDir: rigs, out });
    expect(index.runs).toHaveLength(3);
    expect(written).toContain("data/runs/2026-11-02-oslo-chromium.json");
    expect(written).not.toContain("data/reports/2026-11-02-oslo-chromium.md");
    expect(written).not.toContain("data/runs/2026-11-02-oslo-chromium.evidence.json");
    expect(skipped).toBeGreaterThanOrEqual(3);
    expect(statSync(join(out, "data", "runs", "2026-11-02-oslo-chromium.json")).size).toBeLessThan(
      100000,
    );
  });

  it("keeps at most 4000 runs per rig, the newest by date", () => {
    const rigs = tmp();
    for (let i = 0; i < 4002; i += 1)
      put(
        rigs,
        "busy",
        `r${i}`,
        run({ date: i < 2 ? "2026-01-02" : "2026-11-02", device: `d${i}` }, []),
      );
    const out = join(tmp(), "site");
    const { index, skipped } = build({ rigsDir: rigs, out });
    expect(index.runs).toHaveLength(4000);
    expect(index.runs.every((r: { date: string }) => r.date === "2026-11-02")).toBe(true);
    expect(skipped).toBe(2);
  });

  it("drops a malformed foreign run but still writes the site", () => {
    const rigs = setup();
    put(rigs, "lima", "2026-11-04-bad", {
      ...run({ date: "2026-11-04" }),
      results: [{ site: "evil.example", detections: [{ ruleId: 5, severity: "high_priority" }] }],
    });
    const out = join(tmp(), "site");
    const { index, written } = build({ rigsDir: rigs, out });
    expect(index.runs).toHaveLength(3);
    expect(written).toContain("index.html");
    expect(readFileSync(join(out, "index.html"), "utf8")).not.toContain("evil.example");
  });

  it("drops runs dated before 2026 or after tomorrow, in both modes", () => {
    const rigs = setup();
    put(rigs, "lima", "far", run({ date: "9999-12-31" }));
    put(rigs, "lima", "old", run({ date: "2025-12-31" }));
    put(rigs, "lima", "tomorrow", run({ date: "2026-11-07", browser: "firefox" }));
    put(rigs, "lima", "later", run({ date: "2026-11-08", browser: "firefox" }));
    const now = Date.parse("2026-11-06T12:00:00Z");
    const { index, skipped } = build({ rigsDir: rigs, out: join(tmp(), "site"), now });
    const dates = index.runs.map((r: { date: string }) => r.date);
    expect(dates).not.toContain("9999-12-31");
    expect(dates).not.toContain("2025-12-31");
    expect(dates).not.toContain("2026-11-08");
    expect(dates).toContain("2026-11-07");
    expect(skipped).toBeGreaterThanOrEqual(3);
    const single = tmp();
    writeFileSync(join(single, "a.json"), JSON.stringify(run({ date: "9999-12-31" })));
    writeFileSync(join(single, "b.json"), JSON.stringify(run()));
    const r2 = build({ dir: single, out: join(tmp(), "site2"), now });
    expect(r2.index.runs.map((r: { date: string }) => r.date)).toEqual(["2026-11-02"]);
  });

  it("returns no runs for a missing rigs directory", () => {
    const out = join(tmp(), "site");
    const { index } = build({ rigsDir: join(tmp(), "missing"), out });
    expect(index.runs).toEqual([]);
    expect(index.rigs).toEqual([]);
  });
});

describe("reproduce rig resolution", () => {
  const idx = (...rigs: string[]) => ({ rigs: rigs.map((rig) => ({ rig })) });

  it("uses --rig when valid and refuses an invalid one", () => {
    expect(resolveRig("oslo", idx("a", "b"))).toEqual({ rig: "oslo" });
    expect(resolveRig("../x", null).error).toMatch(/invalid --rig/);
  });

  it("picks the only rig in index.json and refuses to guess among several", () => {
    expect(resolveRig("", idx("oslo"))).toEqual({ rig: "oslo" });
    const many = resolveRig("", idx("oslo", "lima"));
    expect(many.error).toMatch(/oslo, lima/);
    expect(many.error).toMatch(/--rig/);
  });

  it("falls back to the legacy file name for a site without a rig list", () => {
    expect(resolveRig("", null)).toEqual({ rig: null });
    expect(resolveRig("", { runs: [] })).toEqual({ rig: null });
    expect(publishedPaths("2026-11-02", "chromium", null)).toEqual([
      "data/runs/2026-11-02-chromium.json",
    ]);
    expect(publishedPaths("2026-11-02", "chromium", "rig-1")).toEqual([
      "data/runs/2026-11-02-rig-1-chromium.json",
      "data/runs/2026-11-02-chromium.json",
    ]);
    expect(publishedPaths("2026-11-02", "chromium", "oslo")).toEqual([
      "data/runs/2026-11-02-oslo-chromium.json",
    ]);
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

describe("seen alongside", () => {
  const fr = (host: string, anchor = "tracker.example"): Alongside => ({
    host,
    anchor,
    scope: "frame",
  });
  const withRuns = (runs: ReturnType<typeof run>[]) =>
    runs.map((r, i) => ({ file: `r-${i}.json`, variant: "chromium", ...r }));

  describe("validRunShape", () => {
    const dir = () => tmp();
    const load = (extra: Partial<Row>) => {
      const d = dir();
      writeFileSync(join(d, "a.json"), JSON.stringify(run({}, [row("a.example", [], extra)])));
      return loadRuns(d).length;
    };
    it("accepts runs without the fields and runs with well-formed ones", () => {
      expect(load({})).toBe(1);
      expect(
        load({
          alongside: [
            fr("creative.cdn-x.test"),
            { host: "p.test", anchor: "syn-0001", scope: "page" },
          ],
          thirdPartyDomainsList: ["cdn-x.test", "a.example"],
          alongsideAnchors: 2,
        }),
      ).toBe(1);
      expect(load({ alongside: [], thirdPartyDomainsList: [], alongsideAnchors: 0 })).toBe(1);
    });
    it("rejects malformed, non-hostname, mis-scoped and over-long fields", () => {
      const bad: Partial<Row>[] = [
        { alongside: "x" as never },
        { alongside: [null as never] },
        { alongside: [{ host: "a.test/path", anchor: "x", scope: "frame" }] },
        { alongside: [{ host: "a.test?q=1", anchor: "x", scope: "frame" }] },
        { alongside: [{ host: "a.test", anchor: "x", scope: "top" }] },
        { alongside: [{ host: "a.test", anchor: 5 as never, scope: "frame" }] },
        { alongside: Array.from({ length: 201 }, () => fr("a.test")) },
        { thirdPartyDomainsList: "a.test" as never },
        { thirdPartyDomainsList: [5 as never] },
        { thirdPartyDomainsList: ["a.test/x"] },
        { thirdPartyDomainsList: Array.from({ length: 1001 }, () => "a.test") },
        { alongsideAnchors: -1 },
        { alongsideAnchors: 1.5 },
        { alongsideAnchors: "1" as never },
      ];
      for (const b of bad) expect(load(b)).toBe(0);
    });
  });

  it("ranks frame scope by share, applies the two site-day minimum and counts page scope apart", () => {
    const runs = withRuns([
      run({ date: "2026-11-02", rig: "rig-1" }, [
        row("s1.example", [], {
          alongside: [
            fr("lead.rare-cdn.test"),
            fr("ads.big.test"),
            { host: "pg.test", anchor: "a", scope: "page" },
          ],
          alongsideAnchors: 1,
          thirdPartyDomainsList: ["rare-cdn.test", "big.test", "pg.test"],
        }),
        row("s2.example", [], {
          alongside: [],
          alongsideAnchors: 0,
          thirdPartyDomainsList: ["big.test"],
        }),
        row("s3.example", [], { alongside: [], thirdPartyDomainsList: ["big.test"] }),
      ]),
      run({ date: "2026-11-03", rig: "rig-2" }, [
        row("s1.example", [], {
          alongside: [fr("lead.rare-cdn.test"), fr("ads.big.test"), fr("once.test")],
          alongsideAnchors: 1,
          thirdPartyDomainsList: ["rare-cdn.test", "big.test", "once.test"],
        }),
        row("s4.example", [], { alongside: [], thirdPartyDomainsList: ["big.test"] }),
      ]),
    ]);
    const a = buildAlongside(runs);
    expect(a.runsWithData).toBe(2);
    expect(a.anchorVisits).toBe(2);
    expect(a.rows.map((r: { host: string }) => r.host)).toEqual([
      "lead.rare-cdn.test",
      "ads.big.test",
    ]);
    expect(a.rows[0]).toMatchObject({ siteDays: 2, seenSiteDays: 2, share: 1 });
    // big.test: alongside on 2 of the 6 site-days it was seen (s1 x2 days, s2, s3, s4).
    expect(a.rows[1]).toMatchObject({ siteDays: 2, seenSiteDays: 5 });
    expect(a.rows[1].share).toBeLessThan(1);
    expect(a.rows.some((r: { host: string }) => r.host === "once.test")).toBe(false);
    expect(a.pageOnly.map((r: { host: string }) => r.host)).toEqual(["pg.test"]);
  });

  it("collapses leading per-visit ID labels, never the registrable domain", () => {
    expect(collapseIdLabels("5654093961794050096120.cm.a.mts.ru")).toBe("*.cm.a.mts.ru");
    expect(collapseIdLabels("78dc3ab0-37c4-42d3-812d-1f1a3d795204.dsp.mts.ru")).toBe(
      "*.dsp.mts.ru",
    );
    expect(collapseIdLabels("0123456789abcdef0123.x.example")).toBe("*.x.example");
    expect(collapseIdLabels("ads.betweendigital.com")).toBe("ads.betweendigital.com");
    expect(collapseIdLabels("cdn123.example")).toBe("cdn123.example");
    expect(collapseIdLabels("123456789012.example")).toBe("123456789012.example");
    expect(collapseIdLabels("12345.cm.example")).toBe("12345.cm.example");
    const runs = withRuns(
      ["2026-11-02", "2026-11-03"].map((date, i) =>
        run({ date }, [
          row("s1.example", [], {
            alongside: [
              fr(`${["5654093961794050096120", "1945977951794053448564"][i]}.cm.mts.test`),
            ],
            alongsideAnchors: 1,
            thirdPartyDomainsList: ["mts.test"],
          }),
        ]),
      ),
    );
    const a = buildAlongside(runs);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]).toMatchObject({ host: "*.cm.mts.test", siteDays: 2 });
  });

  it("counts a site-day once across rigs and variants and lists the rigs", () => {
    const mk = (rig: string, variant: string) => ({
      file: `${rig}-${variant}.json`,
      variant,
      ...run({ rig }, [
        row("s1.example", [], {
          alongside: [fr("h.test")],
          thirdPartyDomainsList: ["h.test"],
        }),
      ]),
    });
    const same = buildAlongside([mk("rig-1", "v1"), mk("rig-2", "v2")]);
    expect(same.rows).toEqual([]);
    const other = {
      file: "x.json",
      variant: "v1",
      ...run({ rig: "rig-2", date: "2026-11-03" }, [
        row("s1.example", [], { alongside: [fr("h.test")], thirdPartyDomainsList: ["h.test"] }),
      ]),
    };
    const two = buildAlongside([mk("rig-1", "v1"), mk("rig-2", "v2"), other]);
    expect(two.rows[0]).toMatchObject({ host: "h.test", siteDays: 2, rigs: ["rig-1", "rig-2"] });
  });

  it("drops entries on the visited site's own registrable domain (never a candidate)", () => {
    expect(sameSite("www.s1.example", "s1.example")).toBe(true);
    expect(sameSite("cdn.s1.example", "s1.example")).toBe(true);
    expect(sameSite("lead.cdn.test", "s1.example")).toBe(false);
    const runs = withRuns(
      ["2026-11-02", "2026-11-03"].map((date) =>
        run({ date }, [
          row("s1.example", [], {
            alongside: [
              fr("www.s1.example"),
              fr("static.s1.example"),
              { host: "s1.example", anchor: "a", scope: "page" },
              fr("lead.cdn.test"),
            ],
            alongsideAnchors: 1,
            thirdPartyDomainsList: ["cdn.test", "s1.example"],
          }),
        ]),
      ),
    );
    const a = buildAlongside(runs);
    expect(a.rows.map((r: { host: string }) => r.host)).toEqual(["lead.cdn.test"]);
    expect(a.pageOnly).toEqual([]);
    expect(a.frameHosts).toBe(1);
  });

  it("the page's disclaimer is the same text as the extension's", () => {
    expect(ALONGSIDE_DISCLAIMER).toBe(SEEN_ALONGSIDE_DISCLAIMER);
  });

  it("builds from runs without the fields and shows an explanatory empty state", () => {
    const runs = withRuns([run()]);
    const idx = buildIndex(runs);
    expect(idx.alongside).toMatchObject({ runsWithData: 0, rows: [], pageOnly: [] });
    const html = renderHtml(idx);
    expect(html).toContain("Seen alongside documented hosts");
    expect(html).toContain("not detections");
    expect(html).toContain("No run in this period recorded this measurement yet");
    expect(html).not.toMatch(/<script/i);
  });

  it("renders the table with the disclaimer and the anchor note, escaped", () => {
    const runs = withRuns(
      ["2026-11-02", "2026-11-03"].map((date) =>
        run({ date }, [
          row("s.example", [], {
            alongside: [fr("lead.cdn.test", "tracker.example")],
            alongsideAnchors: 1,
            thirdPartyDomainsList: ["cdn.test"],
          }),
        ]),
      ),
    );
    const html = renderHtml(buildIndex(runs));
    expect(html).toContain("lead.cdn.test");
    expect(html).toContain("tracker.example");
    expect(html).toContain("2 anchor site-visit(s)");
    expect(html).toContain("leads for researchers");
    expect(html).not.toMatch(/infected|spied|is safe|are safe/i);
  });
});
