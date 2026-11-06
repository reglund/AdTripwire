#!/usr/bin/env node
/**
 * Long-term view over daily exposure runs: reads every JSON written by
 * scripts/exposure-run.mjs (--json) in a directory and writes one Markdown trend report.
 *
 *   node scripts/exposure-trend.mjs [--dir=~/.cache/adtripwire-exposure] [--out=<dir>/trend.md]
 *
 * Sections: runs per day and variant (browser + device), detections by severity, every
 * contact with documented infrastructure (rule known_infra.*) with site and host, and a
 * cumulative table of documented hosts with first/last seen, distinct days and variants.
 * The reading and rendering live in scripts/lib/exposure-runs.mjs (shared with the
 * observatory site build).
 */
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { contactsOf, loadRuns, renderTrendMarkdown } from "./lib/exposure-runs.mjs";

const arg = (k, d) =>
  (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const expand = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const DIR = expand(arg("dir", "~/.cache/adtripwire-exposure"));
const OUT = expand(arg("out", join(DIR, "trend.md")));

if (!existsSync(DIR)) {
  console.error(`no directory ${DIR}`);
  process.exit(2);
}
const runs = loadRuns(DIR);
writeFileSync(OUT, renderTrendMarkdown(runs, { dirLabel: DIR.replace(homedir(), "~") }));
if (runs.length === 0) {
  console.log(`trend → ${OUT} (no runs)`);
  process.exit(0);
}
const days = new Set(runs.map((r) => r.date));
console.log(
  `trend → ${OUT} (${runs.length} runs, ${days.size} days, ${contactsOf(runs).length} signal(s))`,
);
