#!/usr/bin/env node
/**
 * Benign-browsing false-positive evaluation (docs/testing.md, tests/fixtures/benign-browsing.md).
 *
 * Launches headless Firefox with the PRODUCTION build (real indicator set only) through
 * web-ext, opens a list of ordinary ad-supported sites in batches, captures the extension's
 * console, and writes a Markdown report with every detection by rule id and severity.
 * Nothing here contacts known malicious infrastructure; the sites are mainstream publishers.
 *
 *   node scripts/benign-eval.mjs [--sites=path.txt] [--batch=6] [--seconds=60] [--out=docs/evaluations/<date>-benign.md]
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const arg = (k, d) =>
  (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`)
    .split("=")
    .slice(1)
    .join("=");
const BATCH = Number(arg("batch", 6));
const SECONDS = Number(arg("seconds", 60));
if (!Number.isInteger(BATCH) || BATCH < 1) throw new Error("--batch must be an integer >= 1");
if (!Number.isFinite(SECONDS) || SECONDS <= 0) throw new Error("--seconds must be > 0");
const today = new Date().toISOString().slice(0, 10);
const OUT = arg("out", `docs/evaluations/${today}-benign.md`);
const sitesFile = arg("sites", "tests/fixtures/benign-sites.txt");
// Snap-packaged Firefox can only read extension sources under $HOME; allow overriding the dir.
const CHROMIUM = process.argv.includes("--chromium");
const DIST = arg("dist", CHROMIUM ? "apps/extension-chromium/dist" : "apps/extension-firefox/dist");
const SKIP_BUILD = process.argv.includes("--no-build");
const sites = readFileSync(sitesFile, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

if (!SKIP_BUILD) {
  console.log(`building production bundle (${CHROMIUM ? "chromium" : "firefox"})…`);
  execFileSync(
    "node",
    [CHROMIUM ? "apps/extension-chromium/build.mjs" : "apps/extension-firefox/build.mjs"],
    {
      stdio: "inherit",
    },
  );
}
// Chromium: branded Google Chrome ignores --load-extension; prefer Chromium builds. Headless
// Chromium accepts one start URL, so --chromium forces batches of one site.
const chromeBin = CHROMIUM
  ? (process.env.CHROME_BIN ??
    ["chromium", "chromium-browser", "chrome-for-testing"].find((b) => {
      try {
        execFileSync("which", [b], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    }))
  : undefined;
if (CHROMIUM && !chromeBin) throw new Error("no Chromium binary found; set CHROME_BIN");
const EFFECTIVE_BATCH = CHROMIUM ? 1 : BATCH;

const snapCommon = join(homedir(), "snap", "firefox", "common");
const snapChromium = join(homedir(), "snap", "chromium", "common");
const profileBase = CHROMIUM
  ? existsSync(snapChromium)
    ? join(snapChromium, "adtripwire-benign-profile")
    : join(homedir(), ".cache", "adtripwire-benign-chromium-profile")
  : existsSync(snapCommon)
    ? join(snapCommon, "adtripwire-benign-profile")
    : join(homedir(), ".cache", "adtripwire-benign-profile");

const children = new Set();
function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}
function cleanup() {
  for (const c of children) {
    killGroup(c, "SIGTERM");
    setTimeout(() => killGroup(c, "SIGKILL"), 3000).unref();
  }
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("exit", cleanup);

const logs = [];
for (let i = 0; i < sites.length; i += EFFECTIVE_BATCH) {
  const batch = sites.slice(i, i + EFFECTIVE_BATCH);
  console.log(`batch ${i / EFFECTIVE_BATCH + 1}: ${batch.join(", ")}`);
  // Fresh profile per batch: a reused profile can be locked by a lingering instance.
  const profile = `${profileBase}-${i / EFFECTIVE_BATCH + 1}`;
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const args = CHROMIUM
    ? [
        "--headless=new",
        `--user-data-dir=${profile}`,
        `--load-extension=${resolve(DIST)}`,
        "--enable-logging=stderr",
        "--v=0",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--metrics-recording-only",
        ...batch,
      ]
    : [
        "exec",
        "web-ext",
        "run",
        "-s",
        DIST,
        "--no-input",
        "--verbose",
        "--arg=-headless",
        `--firefox-profile=${profile}`,
        "--profile-create-if-missing",
        "--keep-profile-changes",
        "--pref",
        "devtools.console.stdout.content=true",
        ...batch.flatMap((u) => ["--start-url", u]),
      ];
  const ff = spawn(CHROMIUM ? chromeBin : "pnpm", args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  children.add(ff);
  let log = "";
  ff.stdout.on("data", (d) => (log += d.toString()));
  ff.stderr.on("data", (d) => (log += d.toString()));
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  killGroup(ff, "SIGTERM"); // whole group: pnpm → web-ext → Firefox
  setTimeout(() => killGroup(ff, "SIGKILL"), 3000).unref();
  children.delete(ff);
  await new Promise((r) => setTimeout(r, 2000));
  const readyHere = /\[AdTripwire\] ready:/.test(log);
  console.log(
    `  extension ready: ${readyHere ? "yes" : "NO"}; AdTripwire lines: ${(log.match(/\[AdTripwire\]/g) ?? []).length}`,
  );
  logs.push({ batch, log });
}

/**
 * Console-derived parsing. Web pages share the same stdout channel as the extension, so a
 * hostile page could print look-alike lines. Mitigations: strict anchored formats, an
 * allow-list of severities, rule ids restricted to the engine's id grammar, no free text
 * reproduced in the report, and a cross-check against the extension's own `stats:` counters.
 */
const PREFIX = CHROMIUM
  ? /^.*:INFO:CONSOLE:\d+\] "\[AdTripwire\] /
  : /^(?:.*Firefox stdout: )?console\.(?:info|warn|error): "\[AdTripwire\] /;
const RULE_ID = /^[a-z_]+\.[a-z_]+$/;
const SEVERITIES = new Set(["informational", "suspicious", "elevated", "high_priority"]);
const parsed = logs.flatMap(({ batch, log }) =>
  log
    .split("\n")
    .filter((l) => PREFIX.test(l))
    .map((l) =>
      l
        .replace(PREFIX, "")
        .replace(/", source: .*$/, "")
        .replace(/"$/, ""),
    )
    .map((line) => ({ batch, line })),
);
const detections = [];
let ready = 0;
const statsLines = [];
for (const { batch, line } of parsed) {
  let m;
  if ((m = /^detection ([a-z_.]+) \[(\w+)\] /.exec(line))) {
    if (RULE_ID.test(m[1]) && SEVERITIES.has(m[2]))
      detections.push({ batch, rule: m[1], sev: m[2] });
  } else if ((m = /^escalated ([a-z_.]+) (\w+) (?:→|\\u2192) (\w+):/.exec(line))) {
    if (RULE_ID.test(m[1]) && SEVERITIES.has(m[3]))
      detections.push({ batch, rule: m[1], sev: m[3], escalated: true });
  } else if (/^ready: \d+ indicators, ruleset \d+r-[0-9a-f]+, caps=[a-z_,]+/.test(line)) {
    ready++;
  } else if (
    (m = /^stats: observed=(\d+) ingested=(\d+) inspections=(\d+) detections=(\d+)$/.exec(line))
  ) {
    statsLines.push({
      batch,
      observed: +m[1],
      ingested: +m[2],
      inspections: +m[3],
      detections: +m[4],
    });
  }
}
const byRule = new Map();
for (const d of detections) {
  const key = `${d.rule}|${d.sev}`;
  const e = byRule.get(key) ?? { rule: d.rule, sev: d.sev, count: 0, batches: new Set() };
  e.count++;
  e.batches.add(d.batch.join(", "));
  byRule.set(key, e);
}
const rows = [...byRule.values()].sort((a, b) => b.count - a.count);
const high = rows.filter((r) => r.sev === "high_priority" || r.sev === "elevated");
// Cross-check: the extension's own counters must be able to account for the parsed lines.
const statsDetections = statsLines.reduce((acc, s) => {
  acc[s.batch.join(", ")] = Math.max(acc[s.batch.join(", ")] ?? 0, s.detections);
  return acc;
}, {});
const parsedNew = detections.filter((d) => !d.escalated).length;
const statsTotal = Object.values(statsDetections).reduce((a, b) => a + b, 0);
const consistent = statsLines.length === 0 || parsedNew <= statsTotal;
const statsSummary = statsLines.length
  ? Object.entries(
      statsLines.reduce((acc, s) => {
        acc[s.batch.join(", ")] = s;
        return acc;
      }, {}),
    )
      .map(
        ([, s], idx) =>
          `batch ${idx + 1}: observed=${s.observed} ingested=${s.ingested} inspections=${s.inspections} detections=${s.detections}`,
      )
      .join("; ")
  : "no stats lines (build predates stats logging)";

const md = `# Benign-browsing evaluation — ${today}

Protocol: \`tests/fixtures/benign-browsing.md\`. Production build (real indicator set only),
headless ${CHROMIUM ? "Chromium" : "Firefox"}, ${sites.length} sites in batches of ${EFFECTIVE_BATCH}, ${SECONDS} s per batch, default settings,
Enhanced Tracking Protection at its default. Script: \`scripts/benign-eval.mjs\`.

Extension ready lines observed: ${ready} of ${logs.length} batches.
Sensor activity (last stats line per batch, counts only): ${statsSummary}.
Console cross-check: ${consistent ? "parsed detection lines are consistent with the extension's own counters" : "**INCONSISTENT** — more detection lines parsed than the extension's counters report; treat this run as possibly tampered with by a page"}.

## Detections by rule and severity

| Rule | Severity | Count | Seen in batches |
|---|---|---|---|
${rows.length ? rows.map((r) => `| \`${r.rule}\` | ${r.sev} | ${r.count} | ${[...r.batches].length} |`).join("\n") : "| (none) | | | |"}

## Verdict

${high.length === 0 ? "No elevated or high-priority detections during benign browsing. " : `**${high.reduce((n, r) => n + r.count, 0)} elevated/high-priority detections** require triage (see below). `}Informational and suspicious detections describe exposure to ad-tech behaviour and are expected at some rate; they are listed for tuning, not as findings.

## Triage notes

${high.length ? high.map((r) => `- \`${r.rule}\` (${r.sev}, ${r.count}): _to be triaged: rule logic, indicator classification, or genuine exposure._`).join("\n") : "- Nothing to triage at elevated or above."}

## Provenance of this report

Derived from the extension's console output captured by web-ext. Lines are parsed with
anchored formats and only rule ids and severities are reproduced; no summaries, hostnames
or URLs from the log appear here. Web pages share the console channel, so a page could in
principle print look-alike lines; the cross-check above compares parsed counts with the
extension's own counters.

## Limitations of this run

- Headless Firefox in a fresh profile: no consent-dialog interaction, no scrolling, no clicks; some ad slots never render.
- ${SECONDS} s per batch captures initial loads only. Repeated-exposure (F) cannot fire within one run.
- Sites were loaded concurrently in one window; tab-level correlation sees them as separate tabs.
`;
mkdirSync("docs/evaluations", { recursive: true });
writeFileSync(OUT, md);
writeFileSync(
  "node_modules/.cache/adtripwire/benign-eval.log",
  logs.map((l) => l.log).join("\n\n=====\n\n"),
);
console.log(`\nwrote ${OUT}\n`);
console.log(md.split("## Provenance")[0]);
