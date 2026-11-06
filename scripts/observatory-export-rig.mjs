#!/usr/bin/env node
/**
 * Exports one rig's runs for publication under rigs/<rig>/ on the observatory branch (Phase 8b).
 *
 *   node scripts/observatory-export-rig.mjs --dir=<cache> --out=<dir> --rig=<name>
 *        [--country=XX] [--network=home|mobile|office|datacentre]
 *
 * Empties <out> (refused unless it does not exist, is empty, or already holds rig.json from an
 * earlier export, so a mistyped --out never wipes another directory), then writes scrubbed copies (home directory and login name removed) of every run
 * JSON in <cache> as runs/<date>-<slug>.json (adding `rig` when the run has none), the evidence
 * export as runs/<date>-<slug>.evidence.json and the Markdown report as reports/<date>-<slug>.md
 * when present, plus rig.json { rig, country?, network?, exportedAt, runs }. Slugs come from
 * scripts/lib/exposure-runs.mjs. Reads only <cache>; makes no network requests.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadRuns, scrub, variantSlug } from "./lib/exposure-runs.mjs";

const RIG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const NETWORKS = ["home", "mobile", "office", "datacentre"];

function identity() {
  let user = basename(homedir());
  try {
    user = userInfo().username || user;
  } catch {
    /* keep the directory name */
  }
  return { home: homedir(), user };
}

/**
 * Writes the export; returns { runs, files }. identity is { home, user } for the scrub.
 * Throws on invalid input or when out contains .git.
 */
export function exportRig({
  dir,
  out,
  rig,
  country,
  network,
  identity: ident = { home: homedir(), user: basename(homedir()) },
  exportedAt = new Date().toISOString(),
}) {
  if (!RIG_RE.test(rig ?? "")) throw new Error(`--rig must match ${RIG_RE}`);
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error("--country must be two capitals");
  if (network && !NETWORKS.includes(network))
    throw new Error(`--network must be one of ${NETWORKS.join(", ")}`);
  if (!existsSync(dir)) throw new Error(`no directory ${dir}`);
  if (existsSync(join(out, ".git")))
    throw new Error(`${out} contains .git; refusing to empty a repository`);
  if (existsSync(out)) {
    const present = readdirSync(out);
    if (present.length > 0 && !present.includes("rig.json"))
      throw new Error(`${out} is not empty and has no rig.json; refusing to empty it`);
  }
  mkdirSync(out, { recursive: true });
  for (const n of readdirSync(out)) rmSync(join(out, n), { recursive: true, force: true });

  const sc = (v) => scrub(v, ident);
  const files = [];
  const put = (rel, text) => {
    const p = join(out, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, text);
    files.push(rel);
  };
  const used = new Set();
  let runs = 0;
  for (const r of loadRuns(dir)) {
    const stem = r.file.replace(/\.json$/, "");
    let name = `${r.date}-${variantSlug(r)}`;
    for (let i = 2; used.has(name); i += 1) name = `${r.date}-${variantSlug(r)}-${i}`;
    used.add(name);
    const { file: _file, variant: _variant, ...orig } = r;
    const body = { ...orig, ...(orig.rig ? {} : { rig }) };
    put(`runs/${name}.json`, JSON.stringify(sc(body), null, 2) + "\n");
    runs += 1;
    const evidencePath = join(dir, `${stem}.evidence.json`);
    if (existsSync(evidencePath)) {
      const text = readFileSync(evidencePath, "utf8");
      let ev;
      try {
        ev = JSON.stringify(sc(JSON.parse(text)), null, 2) + "\n";
      } catch {
        ev = sc(text);
      }
      put(`runs/${name}.evidence.json`, ev);
    }
    const reportPath = join(dir, "reports", `${stem}.md`);
    if (existsSync(reportPath)) put(`reports/${name}.md`, sc(readFileSync(reportPath, "utf8")));
  }
  put(
    "rig.json",
    JSON.stringify(
      {
        rig,
        ...(country ? { country } : {}),
        ...(network ? { network } : {}),
        exportedAt,
        runs,
      },
      null,
      2,
    ) + "\n",
  );
  return { runs, files };
}

function main() {
  const argv = process.argv.slice(2);
  const get = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const expand = (p) => (p && p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
  const dir = expand(get("dir") ?? "~/.cache/adtripwire-exposure");
  const out = expand(get("out"));
  if (!out) {
    console.error("usage: observatory-export-rig.mjs --dir=<cache> --out=<dir> --rig=<name>");
    process.exit(2);
  }
  try {
    const r = exportRig({
      dir,
      out,
      rig: get("rig"),
      ...(get("country") ? { country: get("country") } : {}),
      ...(get("network") ? { network: get("network") } : {}),
      identity: identity(),
    });
    console.log(`rig export → ${out} (${r.runs} runs, ${r.files.length} files)`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
