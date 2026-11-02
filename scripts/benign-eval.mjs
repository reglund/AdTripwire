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
import { join } from "node:path";
import { homedir } from "node:os";

const arg = (k, d) =>
  (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`)
    .split("=")
    .slice(1)
    .join("=");
const BATCH = Number(arg("batch", 6));
const SECONDS = Number(arg("seconds", 60));
const today = new Date().toISOString().slice(0, 10);
const OUT = arg("out", `docs/evaluations/${today}-benign.md`);
const sitesFile = arg("sites", "tests/fixtures/benign-sites.txt");
// Snap-packaged Firefox can only read extension sources under $HOME; allow overriding the dir.
const DIST = arg("dist", "apps/extension-firefox/dist");
const SKIP_BUILD = process.argv.includes("--no-build");
const sites = readFileSync(sitesFile, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

if (!SKIP_BUILD) {
  console.log("building production bundle…");
  execFileSync("node", ["apps/extension-firefox/build.mjs"], { stdio: "inherit" });
}

const snapCommon = join(homedir(), "snap", "firefox", "common");
const profileBase = existsSync(snapCommon)
  ? join(snapCommon, "adtripwire-benign-profile")
  : join(homedir(), ".cache", "adtripwire-benign-profile");

const logs = [];
for (let i = 0; i < sites.length; i += BATCH) {
  const batch = sites.slice(i, i + BATCH);
  console.log(`batch ${i / BATCH + 1}: ${batch.join(", ")}`);
  // Fresh profile per batch: a reused profile can be locked by a lingering instance.
  const profile = `${profileBase}-${i / BATCH + 1}`;
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const args = [
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
  const ff = spawn("pnpm", args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  ff.stdout.on("data", (d) => (log += d.toString()));
  ff.stderr.on("data", (d) => (log += d.toString()));
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  try {
    process.kill(-ff.pid, "SIGTERM"); // whole group: pnpm → web-ext → Firefox
  } catch {
    ff.kill("SIGTERM");
  }
  await new Promise((r) => setTimeout(r, 2000));
  const readyHere = /\[AdTripwire\] ready:/.test(log);
  console.log(
    `  extension ready: ${readyHere ? "yes" : "NO"}; AdTripwire lines: ${(log.match(/\[AdTripwire\]/g) ?? []).length}`,
  );
  logs.push({ batch, log });
}

const lines = logs.flatMap(({ batch, log }) =>
  log
    .split("\n")
    .filter((l) => l.includes("[AdTripwire]"))
    .map((l) => ({
      batch,
      line: l
        .replace(/^.*Firefox stdout: /, "")
        .replace(/^console\.\w+: /, "")
        .replace(/^"|"$/g, ""),
    })),
);
const detections = lines.filter((x) => / detection | escalated /.test(x.line));
const byRule = new Map();
for (const d of detections) {
  const m = d.line.match(/(?:detection|escalated) ([a-z_.]+) (?:\[(\w+)\]|(\w+) → (\w+))/);
  if (!m) continue;
  const rule = m[1];
  const sev = m[2] ?? m[4];
  const key = `${rule}|${sev}`;
  const e = byRule.get(key) ?? { rule, sev, count: 0, batches: new Set() };
  e.count++;
  e.batches.add(d.batch.join(", "));
  byRule.set(key, e);
}
const ready = lines.filter((x) => x.line.includes("ready:")).length;
const statsLines = lines
  .filter((x) => x.line.includes("stats:"))
  .map((x) => x.line.replace(/^\[AdTripwire\] /, ""));
if (ready === 0) {
  const err = logs
    .map((l) => l.log)
    .join("\n")
    .split("\n")
    .filter((l) => /\[error\]|WebExtError|Could not install/.test(l))
    .slice(0, 5);
  console.error("INVALID RUN: the extension never reported ready in any batch. No report written.");
  for (const l of err) console.error("  " + l.slice(0, 220));
  process.exit(2);
}
const rows = [...byRule.values()].sort((a, b) => b.count - a.count);
const high = rows.filter((r) => r.sev === "high_priority" || r.sev === "elevated");

const md = `# Benign-browsing evaluation — ${today}

Protocol: \`tests/fixtures/benign-browsing.md\`. Production build (real indicator set only),
headless Firefox, ${sites.length} sites in batches of ${BATCH}, ${SECONDS} s per batch, default settings,
Enhanced Tracking Protection at its default. Script: \`scripts/benign-eval.mjs\`.

Extension ready lines observed: ${ready} of ${logs.length} batches.
Sensor activity (last stats line per batch, counts only): ${statsLines.length ? statsLines.slice(-logs.length).join("; ") : "no stats lines (build predates stats logging)"}.

## Detections by rule and severity

| Rule | Severity | Count | Seen in batches |
|---|---|---|---|
${rows.length ? rows.map((r) => `| \`${r.rule}\` | ${r.sev} | ${r.count} | ${[...r.batches].length} |`).join("\n") : "| (none) | | | |"}

## Verdict

${high.length === 0 ? "No elevated or high-priority detections during benign browsing. " : `**${high.reduce((n, r) => n + r.count, 0)} elevated/high-priority detections** require triage (see below). `}Informational and suspicious detections describe exposure to ad-tech behaviour and are expected at some rate; they are listed for tuning, not as findings.

## Triage notes

${high.length ? high.map((r) => `- \`${r.rule}\` (${r.sev}, ${r.count}): _to be triaged: rule logic, indicator classification, or genuine exposure._`).join("\n") : "- Nothing to triage at elevated or above."}

## Raw detection lines (sanitized by the extension; hostnames only)

${detections.length ? detections.map((d) => `- ${d.line.slice(0, 220)}`).join("\n") : "- none"}

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
console.log(md.split("## Raw")[0]);
