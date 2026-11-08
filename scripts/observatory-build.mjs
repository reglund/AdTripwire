#!/usr/bin/env node
/**
 * Static observatory site built from the daily exposure run output (harness output only).
 *
 *   node scripts/observatory-build.mjs [--dir=~/.cache/adtripwire-exposure] [--out=<dir>/site]
 *        [--rig=rig-1]
 *   node scripts/observatory-build.mjs --rigs=<dir with one subdirectory per rig> --out=<site>
 *
 * Reads every run JSON in --dir (see scripts/lib/exposure-runs.mjs) plus the matching
 * reports/<name>.md and <name>.evidence.json when present (single rig: every run without a
 * `rig` field is attributed to --rig). With --rigs it reads <dir>/<rig>/runs/*.json, the
 * evidence next to them, <dir>/<rig>/reports/*.md and the optional <dir>/<rig>/rig.json
 * (country, network), skipping directories whose name is not a valid rig name. Only real
 * directories and regular files of at most 5 MB are read (a symbolic link is never followed), at
 * most 2000 runs per rig (the newest), and runs dated before 2026-01-01 or after tomorrow are
 * dropped; whatever is left out is counted in the `skipped` number build() returns. Site files are
 * always named <date>-<rig>-<slug>. It removes the rig's home directory and
 * login name (as \`/home/<user>\`) from every string, and writes index.html (inline CSS, no JavaScript, every value
 * through esc()) and data/ (runs, evidence, reports, trend.md, index.json, README.md).
 * Nothing else is read. Exports buildIndex, renderHtml, scrub and friends for tests.
 */
import { mkdirSync, writeFileSync, existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_RIG,
  MAX_FILE_BYTES,
  MAX_RUNS_PER_RIG,
  RIG_NETWORKS,
  SEV,
  contactsOf,
  severityText,
  hostTable,
  isRealDir,
  isStrong,
  loadRuns,
  readRegularFile,
  readingNotes,
  renderTrendMarkdown,
  rigOf,
  runStats,
  scrub,
  validRigName,
  variantSlug,
} from "./lib/exposure-runs.mjs";
import { registrable, sameSite } from "./lib/registrable.mjs";

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

/** Unique <date>-<rig>-<slug> stem per run, keyed by the run's `file` key. */
export function assignNames(runs) {
  const used = new Set();
  const names = new Map();
  for (const r of runs) {
    const base = `${r.date}-${rigOf(r)}-${variantSlug(r)}`.replace(/[^A-Za-z0-9._-]+/g, "-");
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}-${i}`;
    used.add(name);
    names.set(r.file, name);
  }
  return names;
}

const validCountry = (c) => (typeof c === "string" && /^[A-Z]{2}$/.test(c) ? c : null);
const validNetwork = (n) => (RIG_NETWORKS.includes(n) ? n : null);

/** Minimum distinct site-days alongside before a host is ranked. */
export const ALONGSIDE_MIN_SITE_DAYS = 2;
/** Most rows kept in each "seen alongside" table of the index. */
const ALONGSIDE_TABLE_MAX = 200;

/**
 * "Seen alongside documented hosts", aggregated over every run of every rig.
 *
 * A site-day is a distinct (date, site) pair across rigs and variants: the same site seen by
 * two rigs on one day is one site-day. Only rows that carry `alongside` count as having data;
 * the denominator (site-days the host's registrable domain was seen) only counts rows that
 * carry `thirdPartyDomainsList`, and is never below the numerator. Frame scope is ranked;
 * page scope (the anchor sat in the top document) is counted separately and never ranked.
 * Nothing here is a detection; the anchors are indicator ids or documented hostnames.
 */
const ID_LABEL =
  /^(?:\d{12,}|[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Collapse leading per-visit ID labels (long digit runs, long hex, UUIDs) into "*", so
 * "5654093961794050096120.cm.a.mts.ru" and "78dc3ab0-...-208fc5002e5a.dsp.mts.ru" count as
 * "*.cm.a.mts.ru" and "*.dsp.mts.ru" instead of one row per visit. The registrable domain is
 * never collapsed.
 */
export function collapseIdLabels(host) {
  const labels = host.split(".");
  const keep = registrable(host).split(".").length;
  let i = 0;
  while (i < labels.length - keep && ID_LABEL.test(labels[i])) i += 1;
  return i === 0 ? host : ["*", ...labels.slice(i)].join(".");
}

export function buildAlongside(runs) {
  const frame = new Map();
  const page = new Map();
  let runsWithData = 0;
  let visitsWithData = 0;
  let anchorVisits = 0;
  const listDays = []; // [siteDay, Set<registrable>]
  const add = (m, host, siteDay, anchor, rig) => {
    const e = m.get(host) ?? { days: new Set(), anchors: new Set(), rigs: new Set() };
    e.days.add(siteDay);
    e.anchors.add(anchor);
    e.rigs.add(rig);
    m.set(host, e);
  };
  for (const r of runs) {
    const rig = rigOf(r);
    let any = false;
    for (const row of r.results) {
      const siteDay = `${r.date}|${row.site}`;
      if (Array.isArray(row.thirdPartyDomainsList))
        listDays.push([siteDay, new Set(row.thirdPartyDomainsList)]);
      if (!Array.isArray(row.alongside)) continue;
      any = true;
      visitsWithData += 1;
      let kept = 0;
      for (const a of row.alongside) {
        // The visited site's own registrable domain is never a candidate.
        if (typeof row.site === "string" && sameSite(a.host, row.site)) continue;
        add(a.scope === "frame" ? frame : page, collapseIdLabels(a.host), siteDay, a.anchor, rig);
        kept += 1;
      }
      if ((row.alongsideAnchors ?? 0) > 0 || kept > 0) anchorVisits += 1;
    }
    if (any) runsWithData += 1;
  }
  const domains = new Set([...frame.keys(), ...page.keys()].map(registrable));
  const seenDays = new Map([...domains].map((d) => [d, new Set()]));
  for (const [siteDay, set] of listDays) for (const d of set) seenDays.get(d)?.add(siteDay);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const rows = [...frame]
    .filter(([, e]) => e.days.size >= ALONGSIDE_MIN_SITE_DAYS)
    .map(([host, e]) => {
      const seen = Math.max(seenDays.get(registrable(host))?.size ?? 0, e.days.size);
      return {
        host,
        siteDays: e.days.size,
        seenSiteDays: seen,
        share: e.days.size / seen,
        anchors: [...e.anchors].sort(),
        rigs: [...e.rigs].sort(),
      };
    })
    .sort((a, b) => b.share - a.share || b.siteDays - a.siteDays || cmp(a.host, b.host))
    .slice(0, ALONGSIDE_TABLE_MAX);
  const pageOnly = [...page]
    .filter(([host]) => !frame.has(host))
    .map(([host, e]) => ({
      host,
      siteDays: e.days.size,
      anchors: [...e.anchors].sort(),
      rigs: [...e.rigs].sort(),
    }))
    .sort((a, b) => b.siteDays - a.siteDays || cmp(a.host, b.host))
    .slice(0, ALONGSIDE_TABLE_MAX);
  return {
    minSiteDays: ALONGSIDE_MIN_SITE_DAYS,
    runsWithData,
    runsTotal: runs.length,
    visitsWithData,
    anchorVisits,
    frameHosts: frame.size,
    rows,
    pageOnly,
  };
}

/**
 * The index.json content. extras maps a run's `file` key to { evidence, report } booleans (which
 * optional files exist); absent entries mean neither. rigMeta maps a rig name to its declared
 * { country, network } (from rig.json); a rig without an entry falls back to the declaration in
 * its newest run, else null.
 */
export function buildIndex(
  runs,
  { generatedAt = new Date().toISOString(), extras = {}, rigMeta = {} } = {},
) {
  const names = assignNames(runs);
  const allContacts = [];
  const entries = runs.map((r) => {
    const name = names.get(r.file);
    const s = runStats(r);
    const mine = contactsOf([r]);
    const slug = variantSlug(r);
    const rig = rigOf(r);
    for (const c of mine)
      allContacts.push({
        date: c.date,
        rig,
        variant: c.variant,
        slug,
        site: c.site,
        ruleId: c.ruleId,
        severity: c.severity,
        ...(Array.isArray(c.hostnames) ? { hostnames: c.hostnames } : {}),
        ...(c.repeat ? { repeat: true } : {}),
      });
    const x = extras[r.file] ?? {};
    return {
      file: `data/runs/${name}.json`,
      ...(x.evidence ? { evidence: `data/runs/${name}.evidence.json` } : {}),
      ...(x.report ? { report: `data/reports/${name}.md` } : {}),
      date: r.date,
      rig,
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
  const rigs = [...new Set(entries.map((e) => e.rig))].sort().map((rig) => {
    const es = entries.filter((e) => e.rig === rig);
    const mineRuns = runs.filter((r) => rigOf(r) === rig);
    const declared = (key, ok) =>
      [...mineRuns]
        .reverse()
        .map((r) => ok(r[key]))
        .find(Boolean) ?? null;
    return {
      rig,
      country: validCountry(rigMeta[rig]?.country) ?? declared("rigCountry", validCountry),
      network: validNetwork(rigMeta[rig]?.network) ?? declared("rigNetwork", validNetwork),
      days: new Set(es.map((e) => e.date)).size,
      runs: es.length,
      variants: new Set(es.map((e) => e.variant)).size,
      contacts: es.reduce((a, e) => a + e.contacts, 0),
      hosts: new Set(allContacts.filter((c) => c.rig === rig).flatMap((c) => c.hostnames ?? []))
        .size,
    };
  });
  return {
    schemaVersion: 1,
    generatedAt,
    period: {
      from,
      to,
      days: dates.length,
      calendarDays: calendar.length || dates.length,
    },
    rigs,
    runs: entries,
    hosts: hostTable(allContacts),
    contacts: allContacts,
    alongside: buildAlongside(runs),
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

export const ALONGSIDE_DISCLAIMER =
  "Hostnames that appeared in the same ad frame as a documented host. These are not detections and say nothing about the hosts themselves; they are leads for researchers. The list fills slowly: documented hosts are rare.";

function renderAlongside(a, out) {
  out.push(`<h2>Seen alongside documented hosts</h2>`);
  out.push(`<p class="note">${esc(ALONGSIDE_DISCLAIMER)}</p>`);
  if (!a || a.runsWithData === 0) {
    out.push(
      `<p>No run in this period recorded this measurement yet (it needs a rig running a build that reports it), so there is nothing to list. That is not a result.</p>`,
    );
    return;
  }
  out.push(
    `<p class="muted">${esc(
      `${a.anchorVisits} anchor site-visit(s) (a documented host was requested) in ${a.visitsWithData} site visit(s) from ${a.runsWithData} of ${a.runsTotal} run(s). Ranked: frame scope only, at least ${a.minSiteDays} site-days, share = site-days alongside / site-days the host's registrable domain was seen. Per-visit ID labels (long numbers, hex, UUIDs) at the start of a hostname are shown as *. A site-day is one site on one day, across rigs and variants.`,
    )}</p>`,
  );
  if (a.rows.length === 0)
    out.push(
      `<p>No hostname has been seen alongside a documented host on ${a.minSiteDays} or more site-days in frame scope${a.anchorVisits === 0 ? ", and no documented host was requested in the recorded visits" : ""}. Hostnames seen in a single site-day are not listed.</p>`,
    );
  else
    out.push(
      table(
        [
          "Host",
          ["Site-days alongside", "n"],
          ["Site-days seen", "n"],
          ["Share", "n"],
          "Documented host(s)",
          "Rigs",
        ],
        a.rows.map((e) => [
          e.host,
          [e.siteDays, "n"],
          [e.seenSiteDays, "n"],
          [`${Math.round(e.share * 100)}%`, "n"],
          e.anchors.join(", "),
          e.rigs.join(", "),
        ]),
      ),
    );
  if (a.pageOnly.length > 0) {
    out.push(
      `<p class="muted">Page scope (the documented host was requested by the top document, so everything the page loaded is alongside it). Counted separately and not ranked.</p>`,
    );
    out.push(
      table(
        ["Host", ["Site-days", "n"], "Documented host(s)", "Rigs"],
        a.pageOnly.map((e) => [e.host, [e.siteDays, "n"], e.anchors.join(", "), e.rigs.join(", ")]),
      ),
    );
  }
}

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
    `<p>Every day an automated harness opens a fixed list of public news and media sites in browsers with synthetic, automated profiles that persist across days (no personal browsing, no logins), and records which ad-delivery hosts the pages contact. The browsers and devices${variants.length ? ` in these runs are: ${esc(variants.join("; "))}` : ""}. Each site is observed for ${esc(seconds.length ? seconds.join(" or ") : "about 60")} s with consent dialogs accepted where one is recognised, the page scrolled and one article opened. Several rigs (measurement machines) may contribute runs; the country and network class of each rig are declared by its owner and are not verified. The extension only observes; it does not block or change traffic. Nothing on this page is about a person or a real device.</p>`,
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
      "Rigs",
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
        (h.rigs ?? []).join(", "),
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
        ["Date", "Rig", "Variant", "Site", "Rule", "Severity", "Hosts"],
        index.contacts.map((c) => [
          c.date,
          c.rig ?? DEFAULT_RIG,
          c.variant,
          c.site,
          raw(`<code>${esc(c.ruleId)}</code>`),
          severityText(c),
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
    const e = bySite.get(c.site) ?? { hosts: [], days: [], variants: [], rigs: [] };
    e.hosts.push(...(c.hostnames ?? []));
    e.days.push(c.date);
    e.variants.push(c.variant);
    e.rigs.push(c.rig ?? DEFAULT_RIG);
    bySite.set(c.site, e);
  }
  if (bySite.size === 0) out.push(`<p>No site has carried a documented host so far.</p>`);
  else
    out.push(
      table(
        ["Site", "Hosts", ["Days", "n"], "Dates", "Rigs", "Variants"],
        [...bySite]
          .map(([site, e]) => ({
            site,
            hosts: uniq(e.hosts),
            days: uniq(e.days).sort(),
            variants: uniq(e.variants),
            rigs: uniq(e.rigs).sort(),
          }))
          .sort((a, b) => b.days.length - a.days.length || a.site.localeCompare(b.site))
          .map((e) => [
            e.site,
            e.hosts.join(", ") || "(not recorded in this run)",
            [e.days.length, "n"],
            e.days.join(", "),
            e.rigs.join(", "),
            e.variants.join(", "),
          ]),
      ),
    );

  // Seen alongside.
  renderAlongside(index.alongside, out);

  // Rigs.
  out.push(`<h2>Rigs</h2>`);
  out.push(
    `<p>A rig is a machine that runs the harness and contributes its runs under its own name. Country and network class are declared by the rig owner and are not verified; no address is recorded.</p>`,
  );
  const rigs = index.rigs ?? [];
  if (rigs.length === 0) out.push(`<p>No runs yet.</p>`);
  else
    out.push(
      table(
        [
          "Rig",
          "Country",
          "Network",
          ["Days run", "n"],
          ["Runs", "n"],
          ["Variants", "n"],
          ["Contacts", "n"],
          ["Distinct hosts", "n"],
        ],
        rigs.map((g) => [
          g.rig,
          g.country ?? "—",
          g.network ?? "—",
          [g.days, "n"],
          [g.runs, "n"],
          [g.variants, "n"],
          [g.contacts, "n"],
          [g.hosts, "n"],
        ]),
      ),
    );

  // Variants side by side, per rig.
  out.push(`<h2>Browsers and devices side by side</h2>`);
  out.push(note());
  const pairs = uniq(runs.map((r) => JSON.stringify([r.rig ?? DEFAULT_RIG, r.variant])))
    .map((k) => JSON.parse(k))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  if (total === 0) out.push(`<p>No runs yet.</p>`);
  else
    out.push(
      table(
        [
          "Rig",
          "Variant",
          ["Days run", "n"],
          ["Mean sites loaded", "n"],
          ["Mean median 3rd-party domains", "n"],
          ["Contacts", "n"],
          ["Distinct hosts", "n"],
        ],
        pairs.map(([g, v]) => {
          const rs = runs.filter((r) => (r.rig ?? DEFAULT_RIG) === g && r.variant === v);
          const hosts = new Set(
            index.contacts
              .filter((c) => (c.rig ?? DEFAULT_RIG) === g && c.variant === v)
              .flatMap((c) => c.hostnames ?? []),
          );
          return [
            g,
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
          "Rig",
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
          r.rig ?? DEFAULT_RIG,
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
      `pnpm observatory:reproduce -- --date=${newest ? newest.date : "YYYY-MM-DD"} --variant=${newest ? newest.slug : "<variant>"} --rig=${newest ? (newest.rig ?? DEFAULT_RIG) : "<rig>"} --from=<site URL or directory>`,
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
            `<li>${esc(r.date)} ${esc(r.rig ?? DEFAULT_RIG)} ${esc(r.variant)}: ${[
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
| \`runs/<date>-<rig>-<variant>.json\` | One run, as written by the run script (fields below). |
| \`runs/<date>-<rig>-<variant>.evidence.json\` | Optional. The extension's evidence export (default redaction profile) for that run. |
| \`reports/<date>-<rig>-<variant>.md\` | Optional. The Markdown report of that run. |

\`<rig>\` is the name of the measurement machine that made the run (lower case letters, digits and
hyphens, for example \`rig-1\`); several rigs may contribute. \`<variant>\` is the slug of browser,
device, ETP setting and site list, for example \`chromium\`, \`chromium-pixel-5\` or
\`firefox-etp-off-yandex-ad-sites\`.

## Run file

| Field | Meaning |
|---|---|
| \`date\` | Day of the run, \`YYYY-MM-DD\`. |
| \`rig\` | Name of the rig that made the run. Absent in runs from before rigs existed; those are attributed to \`rig-1\`. |
| \`rigCountry\` | Optional. ISO 3166-1 alpha-2 country declared by the rig owner. Not verified. |
| \`rigNetwork\` | Optional. Network class declared by the rig owner: \`home\`, \`mobile\`, \`office\` or \`datacentre\`. Not verified. |
| \`presentation\` | Optional, from 2026-11-07. \`{ userAgent, webdriver }\` as the sites saw this visitor; the harness does not disguise itself. |
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
| \`results[].thirdPartyDomainsList\` | Optional. The sorted third-party registrable domains behind the count (at most 1000); the baseline for "seen alongside". |
| \`results[].alongside[]\` | Optional. Hostnames seen in the same ad frame as a documented host during this site: \`host\`, \`anchor\` (documented host or indicator id), \`scope\` (\`frame\` or \`page\`). Leads, not detections. The index collapses leading per-visit ID labels to \`*\`. |
| \`results[].alongsideAnchors\` | Optional. Documented-host anchors opened during this site. |
| \`results[].repeatContacts[]\` | Optional (at most 200). Contact-type detections that already existed when this site started and fired again on it (deduplicated by the engine, so absent from \`detections\`): \`ruleId\`, \`severity\`, \`detectionId\`, \`hostnames\`, \`matchedIndicatorIds\`, \`occurrences\` (added during this site). Not counted in the severity columns. |
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
| \`rigs[]\` | One entry per rig, sorted by name: \`rig\`, \`country\` and \`network\` (declared by the rig owner, or \`null\`), \`days\` (days with runs), \`runs\`, \`variants\`, \`contacts\`, \`hosts\` (distinct documented hosts). |
| \`runs[]\` | One entry per run: \`file\`, optional \`evidence\` and \`report\`, \`date\`, \`rig\`, \`variant\`, \`slug\`, \`browser\`, \`device\`, \`etpOff\`, \`siteList\`, \`seconds\`, \`sites\`, \`loaded\`, \`consent\`, \`requests\`, \`thirdPartyMedian\`, \`bySev\`, \`noisy\` (hidden-iframe detections, counted apart), \`contacts\`, \`strong\`. |
| \`hosts[]\` | Documented hosts: \`host\`, \`first\`, \`last\`, \`days[]\`, \`variants[]\`, \`sites[]\`, \`rigs[]\`. |
| \`contacts[]\` | Contacts: \`date\`, \`rig\`, \`variant\`, \`slug\`, \`site\`, \`ruleId\`, \`severity\`, optional \`hostnames[]\`, and \`repeat: true\` when the engine merged this site's contact into an earlier site's detection in the same run (from \`results[].repeatContacts\`, or reconstructed from \`alongside\` anchors for older runs). |
| \`alongside\` | "Seen alongside documented hosts" (observations, not detections): \`minSiteDays\`, \`runsWithData\`, \`runsTotal\`, \`visitsWithData\`, \`anchorVisits\`, \`frameHosts\`, ranked \`rows[]\` (frame scope) and \`pageOnly[]\`. |

A contact is a detection from a \`known_infra.*\` or \`correlation.*\` rule, or at elevated or above.
\`strong\` counts contacts from \`correlation.*\` rules or at elevated or above.
`;

function parseArgs(argv) {
  const has = (k) => argv.some((a) => a.startsWith(`--${k}=`));
  const get = (k, d) =>
    (argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
  const expand = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
  const dir = expand(get("dir", "~/.cache/adtripwire-exposure"));
  const rigs = has("rigs") ? expand(get("rigs", "")) : null;
  return {
    dir,
    rigs,
    rig: get("rig", DEFAULT_RIG),
    outGiven: has("out"),
    out: expand(get("out", join(dir, "site"))),
  };
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

/** Earliest run date the site accepts. */
export const EARLIEST_RUN_DATE = "2026-01-01";

/**
 * Run sources. Single directory: every run in dir, attributed to `rig` unless it carries a valid
 * rig of its own. Many rigs: dir/<rig>/runs/*.json for every real subdirectory with a valid rig
 * name (anything else is skipped and counted), rig from the directory name, country and network
 * from dir/<rig>/rig.json. Each run's `file` key is unique across the sources; origin maps it to
 * where its evidence and report live. Runs dated before EARLIEST_RUN_DATE or after tomorrow
 * (relative to `now`) are dropped. stats.skipped counts everything left out.
 */
function gather({ dir, rigsDir, rig, now, stats }) {
  const runs = [];
  const origin = new Map();
  const rigMeta = {};
  const skip = (n = 1) => {
    stats.skipped += n;
  };
  const latest = new Date(now + 86400000).toISOString().slice(0, 10);
  // In many-rigs mode the directory name wins over the JSON's `rig`: the directory is what the
  // rig's deploy key wrote to, the JSON is whatever that rig chose to write. A rig can therefore
  // not claim another rig's name. In single mode a valid `rig` in the JSON is kept.
  const add = (list, key, runsDir, reportsDir, fallbackRig, force = false) => {
    for (const r of list) {
      if (r.date < EARLIEST_RUN_DATE || r.date > latest) {
        skip();
        continue;
      }
      const k = key(r.file);
      origin.set(k, { stem: r.file.replace(/\.json$/, ""), runsDir, reportsDir });
      runs.push({
        ...r,
        file: k,
        rig: !force && validRigName(r.rig) ? r.rig : fallbackRig,
      });
    }
  };
  if (rigsDir) {
    let top = [];
    try {
      if (lstatSync(rigsDir).isDirectory()) top = readdirSync(rigsDir, { withFileTypes: true });
      else skip();
    } catch {
      /* a missing rigs directory means no rigs */
    }
    const names = [];
    for (const e of top) {
      if (e.isDirectory() && validRigName(e.name)) names.push(e.name);
      else skip();
    }
    names.sort();
    for (const name of names) {
      const base = join(rigsDir, name);
      // readdir's type comes from the directory entry; check again so a swapped entry is refused.
      if (!isRealDir(base)) {
        skip();
        continue;
      }
      const runsDir = join(base, "runs");
      const reportsDir = join(base, "reports");
      const runsOk = isRealDir(runsDir);
      if (!runsOk && existsLink(runsDir)) skip();
      const reportsOk = isRealDir(reportsDir);
      if (!reportsOk && existsLink(reportsDir)) skip();
      if (runsOk)
        add(
          loadRuns(runsDir, { maxBytes: MAX_FILE_BYTES, maxRuns: MAX_RUNS_PER_RIG, onSkip: skip }),
          (f) => `${name}/${f}`,
          runsDir,
          reportsOk ? reportsDir : null,
          name,
          true,
        );
      const metaText = readRegularFile(join(base, "rig.json"), { onSkip: skip });
      if (metaText !== null)
        try {
          const meta = JSON.parse(metaText);
          rigMeta[name] = { country: meta?.country, network: meta?.network };
        } catch {
          /* rig.json is optional */
        }
    }
  } else {
    add(loadRuns(dir, { onSkip: skip }), (f) => f, dir, join(dir, "reports"), rig);
  }
  runs.sort((a, b) =>
    (a.date + "\0" + a.rig + "\0" + a.variant).localeCompare(
      b.date + "\0" + b.rig + "\0" + b.variant,
    ),
  );
  return { runs, origin, rigMeta };
}

/** True when something (of any kind) exists at path, without following a link. */
function existsLink(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function build({
  dir,
  rigsDir,
  out,
  rig = DEFAULT_RIG,
  identity = rigIdentity(),
  generatedAt,
  now = Date.now(),
}) {
  if (!validRigName(rig)) throw new Error(`invalid rig name "${rig}"`);
  if (existsSync(join(out, ".git")))
    throw new Error(`${out} contains .git; refusing to write the site into a repository`);
  // Start from a clean data/ so runs that were deleted or renamed do not stay published.
  rmSync(join(out, "data"), { recursive: true, force: true });
  const sc = (v) => scrub(v, identity);
  const stats = { skipped: 0 };
  const gathered = gather({ dir, rigsDir, rig, now, stats });
  const runs = gathered.runs.map(sc);
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
    const o = gathered.origin.get(r.file);
    const { file: _file, variant: _variant, ...orig } = r;
    put(`data/runs/${name}.json`, JSON.stringify(orig, null, 2) + "\n");
    const evidenceText = readRegularFile(join(o.runsDir, `${o.stem}.evidence.json`), {
      maxBytes: MAX_FILE_BYTES,
      onSkip: () => {
        stats.skipped += 1;
      },
    });
    const reportText =
      o.reportsDir === null
        ? null
        : readRegularFile(join(o.reportsDir, `${o.stem}.md`), {
            maxBytes: MAX_FILE_BYTES,
            onSkip: () => {
              stats.skipped += 1;
            },
          });
    extras[r.file] = { evidence: evidenceText !== null, report: reportText !== null };
    if (evidenceText !== null) {
      let body;
      try {
        body = JSON.stringify(sc(JSON.parse(evidenceText)), null, 2) + "\n";
      } catch {
        body = sc(evidenceText);
      }
      put(`data/runs/${name}.evidence.json`, body);
    }
    if (reportText !== null) put(`data/reports/${name}.md`, sc(reportText));
  }
  const label = (rigsDir ?? dir).replace(homedir(), "~");
  put("data/trend.md", sc(renderTrendMarkdown(runs, { dirLabel: label })));
  const index = buildIndex(runs, {
    ...(generatedAt ? { generatedAt } : {}),
    extras,
    rigMeta: gathered.rigMeta,
  });
  put("data/index.json", JSON.stringify(index, null, 2) + "\n");
  put("data/README.md", DATA_README);
  put("index.html", renderHtml(index));
  put("README.md", SITE_README);
  return { index, written, skipped: stats.skipped };
}

function main() {
  const { dir, rigs, rig, outGiven, out } = parseArgs(process.argv.slice(2));
  if (!validRigName(rig)) {
    console.error(`invalid --rig "${rig}": use lower case letters, digits and hyphens (1-32)`);
    process.exit(2);
  }
  if (rigs !== null) {
    if (!outGiven) {
      console.error("--rigs needs an explicit --out=<site dir>");
      process.exit(2);
    }
    if (!existsSync(rigs)) {
      console.error(`no directory ${rigs}`);
      process.exit(2);
    }
  } else if (!existsSync(dir)) {
    console.error(`no directory ${dir}`);
    process.exit(2);
  }
  const { index, written, skipped } = build({ dir, rigsDir: rigs, out, rig });
  console.log(
    `observatory → ${out} (${index.runs.length} runs, ${written.length} files${skipped ? `, ${skipped} skipped` : ""})`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
