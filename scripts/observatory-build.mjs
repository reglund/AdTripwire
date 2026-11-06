#!/usr/bin/env node
/**
 * Static observatory site built from the daily exposure run output (harness output only).
 *
 *   node scripts/observatory-build.mjs [--dir=~/.cache/adtripwire-exposure] [--out=<dir>/site]
 *
 * Reads every run JSON in --dir (see scripts/lib/exposure-runs.mjs) plus the matching
 * reports/<name>.md and <name>.evidence.json when present, removes the rig's home directory and
 * login name (as \`/home/<user>\`) from every string, and writes index.html (inline CSS, no JavaScript, every value
 * through esc()) and data/ (runs, evidence, reports, trend.md, index.json, README.md).
 * Nothing else is read. Exports buildIndex, renderHtml, scrub and friends for tests.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { pathToFileURL } from "node:url";
import {
  SEV,
  contactsOf,
  hostTable,
  isStrong,
  loadRuns,
  readingNotes,
  renderTrendMarkdown,
  runStats,
  scrub,
  variantSlug,
} from "./lib/exposure-runs.mjs";

export { scrub };

/** HTML-escapes any value. Every data value in the page goes through this. */
export const esc = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/** Marks markup built in this file. A class instance cannot come out of JSON.parse, so no value from a run file can pass for it. */
class Raw {
  constructor(html) {
    this.html = html;
  }
}
const raw = (html) => new Raw(html);
const cell = (v) => (v instanceof Raw ? v.html : esc(v));

/** Longest calendar the page draws, in days (the newest ones when there are more). */
export const MAX_CALENDAR_DAYS = 400;

/**
 * Every calendar day from..to inclusive as YYYY-MM-DD (empty when either is not a date), at most
 * MAX_CALENDAR_DAYS of them: the newest.
 */
export function dayRange(from, to) {
  const out = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  const start = Math.max(Date.parse(`${from}T00:00:00Z`), end - (MAX_CALENDAR_DAYS - 1) * 86400000);
  for (let t = start; t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Unique <date>-<slug> stem per run, keyed by the run's file name in the source directory. */
export function assignNames(runs) {
  const used = new Set();
  const names = new Map();
  for (const r of runs) {
    const base = `${r.date}-${variantSlug(r)}`.replace(/[^A-Za-z0-9._-]+/g, "-");
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
    used.add(name);
    names.set(r.file, name);
  }
  return names;
}

/**
 * The index.json content. extras maps a run's source file name to { evidence, report }
 * booleans (which optional files exist); absent entries mean neither.
 */
export function buildIndex(runs, { generatedAt = new Date().toISOString(), extras = {} } = {}) {
  const names = assignNames(runs);
  const allContacts = [];
  const entries = runs.map((r) => {
    const name = names.get(r.file);
    const s = runStats(r);
    const mine = contactsOf([r]);
    const slug = variantSlug(r);
    for (const c of mine)
      allContacts.push({
        date: c.date,
        variant: c.variant,
        slug,
        site: c.site,
        ruleId: c.ruleId,
        severity: c.severity,
        ...(Array.isArray(c.hostnames) ? { hostnames: c.hostnames } : {}),
      });
    const x = extras[r.file] ?? {};
    return {
      file: `data/runs/${name}.json`,
      ...(x.evidence ? { evidence: `data/runs/${name}.evidence.json` } : {}),
      ...(x.report ? { report: `data/reports/${name}.md` } : {}),
      date: r.date,
      variant: r.variant,
      slug,
      browser: r.browser,
      device: r.device ?? null,
      etpOff: Boolean(r.etpOff),
      siteList: r.sites ?? null,
      seconds: Number.isFinite(r.seconds) ? r.seconds : null,
      sites: s.total,
      loaded: s.loaded,
      consent: s.consent,
      requests: s.requests,
      thirdPartyMedian: typeof s.median === "number" ? s.median : null,
      bySev: s.bySev,
      noisy: s.noisy,
      contacts: mine.length,
      strong: mine.filter(isStrong).length,
    };
  });
  const dates = [...new Set(runs.map((r) => r.date))].sort();
  const from = dates[0] ?? null;
  const to = dates[dates.length - 1] ?? null;
  const calendar = from ? dayRange(from, to) : [];
  return {
    schemaVersion: 1,
    generatedAt,
    period: {
      from,
      to,
      days: dates.length,
      calendarDays: calendar.length || dates.length,
    },
    runs: entries,
    hosts: hostTable(allContacts),
    contacts: allContacts,
  };
}

const LEGEND =
  "Contact with documented infrastructure means a browser in a synthetic profile requested a host that public reporting describes as part of an ad-delivery path. It is exposure to that path. It is not evidence of targeting or of anything reaching a device.";

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1f23;--muted:#59636e;--line:#d0d7de;--head:#f3f5f7;--accent:#0b5cad;--hit:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9aa4af;--line:#30363d;--head:#161b22;--accent:#58a6ff;--hit:#ff7b72}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:72rem;margin:0 auto;padding:1rem}
h1{font-size:1.6rem;margin:.5rem 0}
h2{font-size:1.2rem;margin:2rem 0 .5rem;border-bottom:1px solid var(--line);padding-bottom:.25rem}
a{color:var(--accent)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}
pre{overflow-x:auto;padding:.75rem;background:var(--head);border:1px solid var(--line);border-radius:4px}
.muted{color:var(--muted)}
.note{margin:.25rem 0 .75rem;padding:.4rem .7rem;border-left:3px solid var(--line);color:var(--muted);font-size:.9rem}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{border-bottom:1px solid var(--line);padding:.3rem .5rem;text-align:left;vertical-align:top}
th{background:var(--head);white-space:nowrap}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
td.day,th.day{text-align:center;padding:.3rem .25rem;min-width:1.6rem}
td.hit{color:var(--hit);font-weight:700}
td.miss,td.none{color:var(--muted)}
.hosts td:first-child{position:sticky;left:0;background:var(--bg)}
@media (max-width:40rem){main{padding:.75rem}h1{font-size:1.35rem}}
`;

const inlineCode = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const note = () => `<p class="note">${esc(LEGEND)}</p>`;
const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (n, d = 1) => (n === null ? "—" : n.toFixed(d));

function table(head, rows, { cls = "" } = {}) {
  const th = head.map((h) => {
    const [t, c] = Array.isArray(h) ? h : [h, ""];
    return `<th${c ? ` class="${esc(c)}"` : ""}>${esc(t)}</th>`;
  });
  const body = rows.map(
    (r) =>
      `<tr>${r
        .map((v) => {
          const [x, c] = Array.isArray(v) ? v : [v, ""];
          return `<td${c ? ` class="${esc(c)}"` : ""}>${cell(x)}</td>`;
        })
        .join("")}</tr>`,
  );
  return `<div class="scroll"><table${cls ? ` class="${esc(cls)}"` : ""}><thead><tr>${th.join("")}</tr></thead><tbody>${body.join("")}</tbody></table></div>`;
}

const uniq = (xs) => [...new Set(xs)];
const hostsText = (c) => (c.hostnames ? c.hostnames.join(", ") : "(not recorded in this run)");

/** The whole index.html as a string. Pure function of the index object. */
export function renderHtml(index) {
  const runs = index.runs;
  const out = [];
  const total = runs.length;
  const period = index.period;
  const runDays = new Set(runs.map((r) => r.date));
  const calendar = period.from ? dayRange(period.from, period.to) : [];
  const dayCols = calendar.length ? calendar : [...runDays].sort();
  const variants = uniq(runs.map((r) => r.variant)).sort();
  const seconds = uniq(runs.map((r) => r.seconds).filter((n) => n !== null)).sort((a, b) => a - b);
  const newest = runs[runs.length - 1];

  out.push(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AdTripwire observatory</title><style>${CSS}</style></head><body><main>`,
  );
  out.push(`<h1>AdTripwire observatory</h1>`);
  out.push(
    total === 0
      ? `<p class="muted">No runs yet. Generated ${esc(index.generatedAt)}.</p>`
      : `<p class="muted">Period ${esc(period.from)} – ${esc(period.to)}: ${esc(period.days)} day(s) with runs of ${esc(period.calendarDays)} calendar day(s), ${esc(total)} run(s), generated ${esc(index.generatedAt)}.</p>`,
  );

  out.push(`<h2>What this is</h2>`);
  out.push(
    `<p>Every day an automated harness opens a fixed list of public news and media sites in browsers with synthetic, automated profiles that persist across days (no personal browsing, no logins), and records which ad-delivery hosts the pages contact. The browsers and devices${variants.length ? ` in these runs are: ${esc(variants.join("; "))}` : ""}. Each site is observed for ${esc(seconds.length ? seconds.join(" or ") : "about 60")} s with consent dialogs accepted where one is recognised, the page scrolled and one article opened. The extension only observes; it does not block or change traffic. Nothing on this page is about a person or a real device.</p>`,
  );
  out.push(`<h2>Legend</h2>`);
  out.push(note());
  out.push(
    `<p><span aria-hidden="true">●</span> contact that day &nbsp; <span aria-hidden="true">○</span> run that day without contact &nbsp; <span aria-hidden="true">·</span> no run that day. The data section links every file behind this page.</p>`,
  );

  // Documented hosts over time.
  out.push(`<h2>Documented hosts over time</h2>`);
  out.push(note());
  if (index.hosts.length === 0) {
    out.push(`<p>No contact with documented infrastructure in any run so far.</p>`);
  } else {
    const head = [
      "Host",
      ...dayCols.map((d, i) => [i === 0 || d.endsWith("-01") ? d.slice(5) : d.slice(8), "day"]),
      "Variants",
      "Sites",
    ];
    const rows = index.hosts.map((h) => {
      const hit = new Set(h.days);
      return [
        h.host,
        ...dayCols.map((d) => {
          const state = hit.has(d)
            ? ["●", "contact", "day hit"]
            : runDays.has(d)
              ? ["○", "run without contact", "day miss"]
              : ["·", "no run", "day none"];
          const label = `${d}: ${state[1]}`;
          return [
            raw(`<span title="${esc(label)}" aria-label="${esc(label)}">${esc(state[0])}</span>`),
            state[2],
          ];
        }),
        h.variants.join(", "),
        h.sites.join(", "),
      ];
    });
    out.push(table(head, rows, { cls: "hosts" }));
  }

  // Signals.
  out.push(`<h2>Signals that matter</h2>`);
  out.push(note());
  if (index.contacts.length === 0) {
    out.push(
      `<p>No contact with documented infrastructure and nothing at elevated or above in any run.</p>`,
    );
  } else {
    out.push(
      table(
        ["Date", "Variant", "Site", "Rule", "Severity", "Hosts"],
        index.contacts.map((c) => [
          c.date,
          c.variant,
          c.site,
          raw(`<code>${esc(c.ruleId)}</code>`),
          c.severity,
          hostsText(c),
        ]),
      ),
    );
  }

  // Sites.
  out.push(`<h2>Sites that carried documented hosts</h2>`);
  out.push(note());
  const bySite = new Map();
  for (const c of index.contacts) {
    const e = bySite.get(c.site) ?? { hosts: [], days: [], variants: [] };
    e.hosts.push(...(c.hostnames ?? []));
    e.days.push(c.date);
    e.variants.push(c.variant);
    bySite.set(c.site, e);
  }
  if (bySite.size === 0) out.push(`<p>No site has carried a documented host so far.</p>`);
  else
    out.push(
      table(
        ["Site", "Hosts", ["Days", "n"], "Dates", "Variants"],
        [...bySite]
          .map(([site, e]) => ({
            site,
            hosts: uniq(e.hosts),
            days: uniq(e.days).sort(),
            variants: uniq(e.variants),
          }))
          .sort((a, b) => b.days.length - a.days.length || a.site.localeCompare(b.site))
          .map((e) => [
            e.site,
            e.hosts.join(", ") || "(not recorded in this run)",
            [e.days.length, "n"],
            e.days.join(", "),
            e.variants.join(", "),
          ]),
      ),
    );

  // Variants side by side.
  out.push(`<h2>Browsers and devices side by side</h2>`);
  out.push(note());
  if (total === 0) out.push(`<p>No runs yet.</p>`);
  else
    out.push(
      table(
        [
          "Variant",
          ["Days run", "n"],
          ["Mean sites loaded", "n"],
          ["Mean median 3rd-party domains", "n"],
          ["Contacts", "n"],
          ["Distinct hosts", "n"],
        ],
        variants.map((v) => {
          const rs = runs.filter((r) => r.variant === v);
          const hosts = new Set(
            index.contacts.filter((c) => c.variant === v).flatMap((c) => c.hostnames ?? []),
          );
          return [
            v,
            [uniq(rs.map((r) => r.date)).length, "n"],
            [`${fmt(mean(rs.map((r) => r.loaded)))} of ${fmt(mean(rs.map((r) => r.sites)))}`, "n"],
            [fmt(mean(rs.map((r) => r.thirdPartyMedian).filter((n) => n !== null))), "n"],
            [rs.reduce((a, r) => a + r.contacts, 0), "n"],
            [hosts.size, "n"],
          ];
        }),
      ),
    );

  // Runs.
  out.push(`<h2>Runs</h2>`);
  out.push(note());
  if (total === 0) out.push(`<p>No runs yet.</p>`);
  else
    out.push(
      table(
        [
          "Date",
          "Variant",
          ["Sites loaded", "n"],
          ["Consent clicked", "n"],
          ["Requests", "n"],
          ["Median 3rd-party domains", "n"],
          ...SEV.map((s) => [s, "n"]),
          ["Hidden iframes", "n"],
          "Files",
        ],
        runs.map((r) => [
          r.date,
          r.variant,
          [`${r.loaded}/${r.sites}`, "n"],
          [r.consent, "n"],
          [r.requests, "n"],
          [r.thirdPartyMedian ?? "—", "n"],
          ...SEV.map((s) => [r.bySev[s] ?? 0, "n"]),
          [r.noisy, "n"],
          raw(
            [
              link(r.file, "json"),
              ...(r.report ? [link(r.report, "report")] : []),
              ...(r.evidence ? [link(r.evidence, "evidence")] : []),
            ].join(" · "),
          ),
        ]),
      ),
    );

  // Reproduce.
  out.push(`<h2>Reproduce a day</h2>`);
  out.push(
    `<p>From a fresh checkout of the repository, one command repeats a published run and compares it with the published file:</p>`,
  );
  out.push(
    `<pre>${esc(
      `pnpm observatory:reproduce -- --date=${newest ? newest.date : "YYYY-MM-DD"} --variant=${newest ? newest.slug : "<variant>"} --from=<site URL or directory>`,
    )}</pre>`,
  );
  out.push(
    `<p>Auctions differ from one visit to the next, so the comparison is made on what is stable: the same site list and variant; sites loaded within 10 % of the published count (never stricter than one site); median third-party domains within a factor of two either way, because a fresh profile accepts consent again and sees more auctions than a warmed one. Documented hosts are listed as shared, only in the published run, or only in the new run, without a pass or fail on them.</p>`,
  );

  // Data.
  out.push(`<h2>Data</h2>`);
  out.push(
    `<p>${link("data/README.md", "README")} describes every field. ${link("data/index.json", "index.json")} is the summary behind this page, ${link("data/trend.md", "trend.md")} is the Markdown trend report.</p>`,
  );
  if (total > 0)
    out.push(
      `<ul>${runs
        .map(
          (r) =>
            `<li>${esc(r.date)} ${esc(r.variant)}: ${[
              link(r.file, "run json"),
              ...(r.report ? [link(r.report, "report")] : []),
              ...(r.evidence ? [link(r.evidence, "evidence export")] : []),
            ].join(" · ")}</li>`,
        )
        .join("")}</ul>`,
    );

  // Method.
  out.push(`<h2>Method and limitations</h2>`);
  out.push(
    `<ul>${[
      ...readingNotes(),
      "The profiles are synthetic and automated, the site list is fixed and small, and each site is visited once per variant and day. The numbers describe those visits only.",
    ]
      .map((n) => `<li>${inlineCode(n)}</li>`)
      .join("")}</ul>`,
  );
  out.push(`</main></body></html>`);
  return out.join("\n") + "\n";
}

/** Landing text for the repository that hosts the site (served next to index.html). */
export const SITE_README = `# AdTripwire observatory

Daily measurements of contact with ad-delivery infrastructure documented in public reporting
on the AdFection campaign, made by the [AdTripwire](https://github.com/reglund/AdTripwire)
exposure harness with synthetic browser profiles over a fixed list of news and media sites.

- \`index.html\` is the readable page (served by GitHub Pages when enabled for this repository).
- \`data/index.json\` is the machine-readable summary; \`data/runs/\` holds every run in full;
  \`data/README.md\` describes each field.

Contact with documented infrastructure means a browser in a synthetic profile requested a host
that public reporting describes as part of an ad-delivery path. It is exposure to that path. It
is not evidence of targeting or of anything reaching a device. Nothing here is about a person.

This repository is written by an automated publisher; changes are proposed in the AdTripwire
repository, not here.
`;

export const DATA_README = `# Observatory data

Everything here is produced by the exposure harness (\`scripts/exposure-run.mjs\`) on a
measurement rig with synthetic profiles. The only thing removed is what identifies the rig
itself: its home directory, and \`/home/<login name>\`, replaced by \`~\` wherever they appear in a
string. Contact with documented infrastructure is exposure to an ad-delivery
path described in public reporting; it is not evidence of targeting or of anything reaching a
device.

## Files

| Path | Content |
|---|---|
| \`index.json\` | Summary used by the site (fields below). |
| \`trend.md\` | Markdown trend report over all runs. |
| \`runs/<date>-<variant>.json\` | One run, as written by the run script (fields below). |
| \`runs/<date>-<variant>.evidence.json\` | Optional. The extension's evidence export (default redaction profile) for that run. |
| \`reports/<date>-<variant>.md\` | Optional. The Markdown report of that run. |

\`<variant>\` is the slug of browser, device, ETP setting and site list, for example \`chromium\`,
\`chromium-pixel-5\` or \`firefox-etp-off-yandex-ad-sites\`.

## Run file

| Field | Meaning |
|---|---|
| \`date\` | Day of the run, \`YYYY-MM-DD\`. |
| \`browser\` | \`firefox\` or \`chromium\`. |
| \`device\` | Emulated device name, or \`null\` for a desktop profile. |
| \`sites\` | Path of the site list used (relative to the repository). |
| \`etpOff\` | \`true\` when Firefox Enhanced Tracking Protection was off. |
| \`seconds\` | Observation time per site. |
| \`totals.sites\` | Sites visited. |
| \`totals.loaded\` | Sites that loaded. |
| \`totals.consent\` | Sites where a consent control was clicked. |
| \`totals.article\` | Sites where an article was opened. |
| \`totals.events\` | Requests observed by the sensor. |
| \`totals.thirdPartyMedian\` | Median third-party registrable domains per loaded site. |
| \`totals.lowAuction\` | Loaded sites that contacted fewer than 10 third-party domains. |
| \`totals.detections[]\` | Every detection of the run: \`ruleId\`, \`severity\`. |
| \`results[].site\` | Site host. |
| \`results[].loaded\` | Whether the page loaded. |
| \`results[].consent\` | \`null\`, or a string of the form \`selector <css>\` or \`text "<label>"\` naming how the consent control was found. |
| \`results[].article\` | Whether an article was opened. |
| \`results[].events\` | Requests observed while this site was open. |
| \`results[].thirdPartyDomains\` | Third-party registrable domains seen on this site. |
| \`results[].error\` | Optional. Why a step failed. |
| \`results[].detections[]\` | Detections raised on this site (below). |

A detection always has \`ruleId\` and \`severity\` (\`informational\`, \`suspicious\`, \`elevated\`,
\`high_priority\`). Optional fields, present only in runs made by newer versions of the run script:

| Field | Meaning |
|---|---|
| \`hostnames\` | Subject hostnames. Older runs record them only for \`known_infra.*\` rules and elevated or above. |
| \`detectionId\` | Id of the detection inside the extension. |
| \`timestamp\` | When it was raised. |
| \`confidence\` | The rule's confidence. |
| \`matchedIndicatorIds\` | Indicator ids that matched. |
| \`occurrenceCount\` | How many times the pattern was seen. |
| \`summary\` | The extension's one-line summary. |
| \`evidence[]\` | Observed strings (hostnames, path patterns, query names) behind the detection. |

## index.json

| Field | Meaning |
|---|---|
| \`schemaVersion\` | \`1\`. |
| \`generatedAt\` | ISO time the site was built. |
| \`period\` | \`from\`, \`to\`, \`days\` (days with runs), \`calendarDays\` (days from first to last). |
| \`runs[]\` | One entry per run: \`file\`, optional \`evidence\` and \`report\`, \`date\`, \`variant\`, \`slug\`, \`browser\`, \`device\`, \`etpOff\`, \`siteList\`, \`seconds\`, \`sites\`, \`loaded\`, \`consent\`, \`requests\`, \`thirdPartyMedian\`, \`bySev\`, \`noisy\` (hidden-iframe detections, counted apart), \`contacts\`, \`strong\`. |
| \`hosts[]\` | Documented hosts: \`host\`, \`first\`, \`last\`, \`days[]\`, \`variants[]\`, \`sites[]\`. |
| \`contacts[]\` | Contacts: \`date\`, \`variant\`, \`slug\`, \`site\`, \`ruleId\`, \`severity\`, optional \`hostnames[]\`. |

A contact is a detection from a \`known_infra.*\` or \`correlation.*\` rule, or at elevated or above.
\`strong\` counts contacts from \`correlation.*\` rules or at elevated or above.
`;

function parseArgs(argv) {
  const get = (k, d) =>
    (argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
  const expand = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
  const dir = expand(get("dir", "~/.cache/adtripwire-exposure"));
  return { dir, out: expand(get("out", join(dir, "site"))) };
}

function rigIdentity() {
  let user = process.env.USER ?? "";
  try {
    user = userInfo().username || user;
  } catch {
    /* keep the environment value */
  }
  return { home: homedir(), user };
}

export function build({ dir, out, identity = rigIdentity(), generatedAt }) {
  if (existsSync(join(out, ".git")))
    throw new Error(`${out} contains .git; refusing to write the site into a repository`);
  // Start from a clean data/ so runs that were deleted or renamed do not stay published.
  rmSync(join(out, "data"), { recursive: true, force: true });
  const sc = (v) => scrub(v, identity);
  const runs = loadRuns(dir).map(sc);
  const names = assignNames(runs);
  const written = [];
  const put = (rel, text) => {
    const p = join(out, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, text);
    written.push(rel);
  };
  const extras = {};
  for (const r of runs) {
    const name = names.get(r.file);
    const stem = r.file.replace(/\.json$/, "");
    const { file: _file, variant: _variant, ...orig } = r;
    put(`data/runs/${name}.json`, JSON.stringify(orig, null, 2) + "\n");
    const evidencePath = join(dir, `${stem}.evidence.json`);
    const reportPath = join(dir, "reports", `${stem}.md`);
    extras[r.file] = { evidence: existsSync(evidencePath), report: existsSync(reportPath) };
    if (extras[r.file].evidence) {
      const text = readFileSync(evidencePath, "utf8");
      let body;
      try {
        body = JSON.stringify(sc(JSON.parse(text)), null, 2) + "\n";
      } catch {
        body = sc(text);
      }
      put(`data/runs/${name}.evidence.json`, body);
    }
    if (extras[r.file].report) put(`data/reports/${name}.md`, sc(readFileSync(reportPath, "utf8")));
  }
  put("data/trend.md", sc(renderTrendMarkdown(runs, { dirLabel: dir.replace(homedir(), "~") })));
  const index = buildIndex(runs, { ...(generatedAt ? { generatedAt } : {}), extras });
  put("data/index.json", JSON.stringify(index, null, 2) + "\n");
  put("data/README.md", DATA_README);
  put("index.html", renderHtml(index));
  put("README.md", SITE_README);
  return { index, written };
}

function main() {
  const { dir, out } = parseArgs(process.argv.slice(2));
  if (!existsSync(dir)) {
    console.error(`no directory ${dir}`);
    process.exit(2);
  }
  const { index, written } = build({ dir, out });
  console.log(`observatory → ${out} (${index.runs.length} runs, ${written.length} files)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
