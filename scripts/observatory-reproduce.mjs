#!/usr/bin/env node
/**
 * Reproduce one published observatory row and compare it with the published run.
 *
 *   node scripts/observatory-reproduce.mjs --date=YYYY-MM-DD --variant=<slug>
 *        [--from=<site dir or https URL>] [--seconds=60] [--limit=N] [--keep] [--dry-run]
 *
 * The variant slug is the one in the published file name (`data/runs/<date>-<slug>.json`):
 * browser, then `-<device slug>`, then `-etp-off`, then `-<site list basename>` when the list
 * is not exposure-sites.txt. It is resolved to the flags of scripts/exposure-run.mjs, the
 * evaluation bundle is built into a scratch directory, one run is made with a fresh profile,
 * and the result is compared with the published JSON on what is deterministic (decision 5 of
 * docs/phase-8-plan.md): same site list, loaded sites within 10 % (never stricter than one site), median third-party domains
 * within a factor of 2 either way (a fresh profile accepts consent again and sees more auctions
 * than a warmed one), documented hosts reported as shared / only published / only now (no pass/fail).
 *
 * Scratch directories live under ~/snap/<browser>/common when that exists (a snap-confined
 * browser cannot read /tmp) and are removed afterwards unless --keep is given. Exit 0 when
 * within tolerance, 1 when outside, 2 on usage or runtime errors.
 */
/* global fetch */
import { KnownDevices } from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_LIST = "exposure-sites";
export const TOLERANCE = { loaded: 0.1, medianFactor: 2 };

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** device slug -> puppeteer KnownDevices name, e.g. "iphone-15" -> "iPhone 15". */
const deviceBySlug = () => {
  const map = new Map();
  for (const name of Object.keys(KnownDevices)) map.set(slugify(name), name);
  return map;
};

/**
 * Reverse of the observatory slug rule. Returns { browser, device, etpOff, siteList, sitesPath }
 * where device is "" for desktop. Throws on a slug that cannot be resolved.
 */
export function flagsForSlug(slug) {
  const m = /^(chromium|firefox)(?:-(.+))?$/.exec(String(slug));
  if (!m) throw new Error(`unknown variant "${slug}": expected chromium or firefox first`);
  const browser = m[1];
  let rest = m[2] ?? "";
  let device = "";
  // Longest device slug first, so "iphone-15-pro" is not read as "iphone-15" + list "pro".
  const devices = [...deviceBySlug()].sort((a, b) => b[0].length - a[0].length);
  for (const [dslug, name] of devices) {
    if (rest === dslug || rest.startsWith(`${dslug}-`)) {
      device = name;
      rest = rest.slice(dslug.length + 1);
      break;
    }
  }
  // Legacy runs (`mobile: true`, no device) were made with the iPhone 15 profile.
  if (!device && (rest === "mobile" || rest.startsWith("mobile-"))) {
    device = "iPhone 15";
    rest = rest.slice("mobile".length + 1);
  }
  let etpOff = false;
  if (rest === "etp-off" || rest.startsWith("etp-off-")) {
    etpOff = true;
    rest = rest.slice("etp-off".length + 1);
  }
  if (etpOff && browser !== "firefox") throw new Error(`"${slug}": --etp-off is Firefox only`);
  const siteList = rest || DEFAULT_LIST;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(siteList))
    throw new Error(`"${slug}": site list name "${siteList}" is not a plain file name`);
  return { browser, device, etpOff, siteList, sitesPath: `tests/fixtures/${siteList}.txt` };
}

const median = (results) => {
  const v = results
    .filter((r) => r.loaded)
    .map((r) => r.thirdPartyDomains)
    .sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};

const documentedHosts = (results) => {
  const hosts = new Set();
  for (const r of results)
    for (const d of r.detections ?? [])
      if (String(d.ruleId).startsWith("known_infra."))
        for (const h of d.hostnames ?? []) hosts.add(h);
  return hosts;
};

/** True when the two medians are within `factor` of each other in either direction. */
const withinFactor = (published, fresh, factor) =>
  published === fresh ||
  (published > 0 && fresh > 0 && Math.max(published, fresh) / Math.min(published, fresh) <= factor);

/** Loaded-sites allowance: 10 % of the published count, but never stricter than one site. */
export const loadedAllowance = (published) => Math.max(1, Math.round(TOLERANCE.loaded * published));

/**
 * Compares a published run JSON with a fresh one. With { limit } both sides are trimmed to the
 * first N sites. Documented hosts are informational only and never affect `withinTolerance`.
 */
export function compareRuns(published, fresh, { limit = 0 } = {}) {
  const trim = (run) => (limit > 0 ? run.results.slice(0, limit) : run.results);
  const p = trim(published);
  const f = trim(fresh);
  const pSites = p.map((r) => r.site);
  const fSites = f.map((r) => r.site);
  const sameSites = pSites.length === fSites.length && pSites.every((s, i) => s === fSites[i]);
  const loaded = {
    published: p.filter((r) => r.loaded).length,
    fresh: f.filter((r) => r.loaded).length,
  };
  const med = { published: median(p), fresh: median(f) };
  const pHosts = documentedHosts(p);
  const fHosts = documentedHosts(f);
  const hosts = {
    shared: [...pHosts].filter((h) => fHosts.has(h)).sort(),
    onlyPublished: [...pHosts].filter((h) => !fHosts.has(h)).sort(),
    onlyNow: [...fHosts].filter((h) => !pHosts.has(h)).sort(),
  };
  const checks = {
    sameSites,
    loadedWithin: Math.abs(loaded.fresh - loaded.published) <= loadedAllowance(loaded.published),
    medianWithin: withinFactor(med.published, med.fresh, TOLERANCE.medianFactor),
  };
  return {
    sites: { published: pSites.length, fresh: fSites.length },
    loaded: { ...loaded, allowed: loadedAllowance(loaded.published) },
    median: med,
    hosts,
    checks,
    withinTolerance: checks.sameSites && checks.loadedWithin && checks.medianWithin,
  };
}

export function formatComparison(c) {
  const mark = (ok) => (ok ? "ok" : "OUTSIDE");
  const list = (a) => (a.length ? a.join(", ") : "none");
  return [
    "comparison (published vs reproduced)",
    `  site list identical    ${c.sites.published} vs ${c.sites.fresh} sites   ${mark(c.checks.sameSites)}`,
    `  loaded                 ${c.loaded.published} vs ${c.loaded.fresh}   (within ${c.loaded.allowed} site(s): 10 %, at least one)   ${mark(c.checks.loadedWithin)}`,
    `  median 3rd-party doms  ${c.median.published} vs ${c.median.fresh}   (within a factor of ${TOLERANCE.medianFactor})   ${mark(c.checks.medianWithin)}`,
    `  documented hosts, shared:         ${list(c.hosts.shared)}`,
    `  documented hosts, only published: ${list(c.hosts.onlyPublished)}`,
    `  documented hosts, only now:       ${list(c.hosts.onlyNow)}`,
    "  (host differences are informational: ad auctions are stochastic and give no pass or fail)",
    `verdict: ${c.withinTolerance ? "within tolerance" : "outside tolerance"}`,
  ].join("\n");
}

const arg = (argv, k, d = "") => {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};

/** Quotes for display only; commands are executed without a shell. */
const shown = (argv) =>
  argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : JSON.stringify(a))).join(" ");

async function loadPublished(from, date, slug) {
  const rel = `data/runs/${date}-${slug}.json`;
  if (/^https:\/\//i.test(from)) {
    const url = `${from.replace(/\/+$/, "")}/${rel}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return { where: url, run: await res.json() };
  }
  const file = join(resolve(from.replace(/^~(?=\/|$)/, homedir())), rel);
  return { where: file, run: JSON.parse(readFileSync(file, "utf8")) };
}

export async function main(argv = process.argv.slice(2)) {
  const date = arg(argv, "date");
  const slug = arg(argv, "variant");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !slug) {
    console.error(
      "usage: observatory-reproduce.mjs --date=YYYY-MM-DD --variant=<slug> [--from=<site dir or https URL>] [--seconds=60] [--limit=N] [--keep] [--dry-run]",
    );
    return 2;
  }
  const from = arg(argv, "from", join(homedir(), ".cache", "adtripwire-exposure", "site"));
  if (/^[a-z][a-z0-9+.-]*:/i.test(from) && !/^https:\/\//i.test(from)) {
    console.error("--from must be an https:// URL or a local path");
    return 2;
  }
  const seconds = Number(arg(argv, "seconds", "60"));
  const limit = Number(arg(argv, "limit", "0"));
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isInteger(limit) || limit < 0) {
    console.error("--seconds must be a positive number and --limit a non-negative integer");
    return 2;
  }
  const keep = argv.includes("--keep");
  const dry = argv.includes("--dry-run");

  let v;
  try {
    v = flagsForSlug(slug);
  } catch (e) {
    console.error(e.message);
    return 2;
  }

  const snapBase = join(homedir(), "snap", v.browser, "common");
  const base = existsSync(snapBase) ? snapBase : tmpdir();
  const work = dry ? join(base, "adtripwire-reproduce-XXXXXX") : null;
  const dir = (w) => ({
    dist: join(w, "dist"),
    profile: join(w, "profile"),
    json: join(w, "run.json"),
    report: join(w, "report.md"),
  });
  const plan = (w) => {
    const p = dir(w);
    const build = ["node", `apps/extension-${v.browser}/build.mjs`, "--eval", `--out=${p.dist}`];
    const run = [
      "node",
      "scripts/exposure-run.mjs",
      `--browser=${v.browser}`,
      ...(v.device ? [`--device=${v.device}`] : []),
      ...(v.etpOff ? ["--etp-off"] : []),
      `--sites=${v.sitesPath}`,
      `--seconds=${seconds}`,
      ...(limit > 0 ? [`--limit=${limit}`] : []),
      `--dist=${p.dist}`,
      `--profile=${p.profile}`,
      `--json=${p.json}`,
      `--out=${p.report}`,
    ];
    return { build, run, p };
  };

  console.log(
    `variant ${slug}: browser=${v.browser} device=${v.device || "(desktop)"} etp-off=${v.etpOff} sites=${v.sitesPath}`,
  );
  if (dry) {
    const { build, run } = plan(work);
    console.log(`published run: ${from.replace(/\/+$/, "")}/data/runs/${date}-${slug}.json`);
    console.log(`cwd: ${ROOT}`);
    console.log(shown(build));
    console.log(shown(run));
    console.log(`(dry run: nothing was built or run; ${work} would be removed afterwards)`);
    return 0;
  }

  let published;
  try {
    published = await loadPublished(from, date, slug);
  } catch (e) {
    console.error(`cannot load the published run: ${e.message}`);
    return 2;
  }
  const pr = published.run;
  if (
    pr.browser !== v.browser ||
    (pr.device ?? (pr.mobile ? "iPhone 15" : "")) !== v.device ||
    Boolean(pr.etpOff) !== v.etpOff ||
    !Array.isArray(pr.results)
  ) {
    console.error(`${published.where} does not match variant ${slug} (browser/device/etpOff)`);
    return 2;
  }
  console.log(
    `published run: ${published.where} (${pr.results.length} sites, ${pr.seconds}s each)`,
  );
  if (pr.seconds !== seconds)
    console.log(`note: published run used ${pr.seconds}s per site, this run uses ${seconds}s`);

  mkdirSync(base, { recursive: true });
  const w = mkdtempSync(join(base, "adtripwire-reproduce-"));
  const { build, run, p } = plan(w);
  try {
    execFileSync(process.execPath, build.slice(1), { cwd: ROOT, stdio: "inherit" });
    execFileSync(process.execPath, run.slice(1), { cwd: ROOT, stdio: "inherit" });
    const fresh = JSON.parse(readFileSync(p.json, "utf8"));
    const c = compareRuns(pr, fresh, { limit });
    console.log(formatComparison(c));
    return c.withinTolerance ? 0 : 1;
  } catch (e) {
    console.error(`reproduction failed: ${e.message}`);
    return 2;
  } finally {
    if (keep) console.log(`kept ${w}`);
    else rmSync(w, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
