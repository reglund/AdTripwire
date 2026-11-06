#!/usr/bin/env node
/**
 * Regenerates the observatory snapshot bundled into the extension
 * (packages/correlation/data/observatory-snapshot.json) from the public observatory's
 * data/index.json.
 *
 *   node scripts/refresh-observatory-snapshot.mjs [--from=<url|site-dir>] [--check]
 *
 *   --from   https URL of index.json, a local site directory (containing data/index.json) or
 *            an index.json file. Default: the public observatory.
 *   --check  compare only (exit 1 when the committed snapshot differs; generatedAt is ignored)
 *
 * Read-only against the source; fetches one public JSON file and nothing else. Dependency-free:
 * the rules mirror validateObservatorySnapshot in packages/correlation/src/observatory.ts,
 * which a test applies to the committed file.
 */
/* global fetch */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const OUT = `${root}packages/correlation/data/observatory-snapshot.json`;
const DEFAULT_SOURCE = "https://reglund.github.io/adtripwire-observatory/data/index.json";
const MAX_HOSTS = 500;
const MAX_SITES = 10;
const RESERVED = /(^|\.)(test|invalid|example|localhost)$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$/;

const args = process.argv.slice(2);
const check = args.includes("--check");
const from = args.find((a) => a.startsWith("--from="))?.slice("--from=".length) ?? DEFAULT_SOURCE;

const fail = (msg) => {
  console.error(`observatory snapshot: ${msg}`);
  process.exit(1);
};

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
function isDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function hostProblem(v) {
  if (typeof v !== "string" || !HOST.test(v)) return "is not a hostname";
  if (IPV4.test(v)) return "is an IP address";
  if (RESERVED.test(v)) return "uses a reserved name";
  return null;
}

async function readIndex(src) {
  if (/^https?:\/\//.test(src)) {
    if (!src.startsWith("https://")) fail("--from must be https or a local path");
    const res = await fetch(src);
    if (!res.ok) fail(`download failed: ${res.status} ${src}`);
    return { index: await res.json(), url: src };
  }
  const file =
    existsSync(src) && statSync(src).isDirectory() ? join(src, "data", "index.json") : src;
  if (!existsSync(file)) fail(`not found: ${file}`);
  // A local copy of the public site: the snapshot still names the public URL as its source.
  return { index: JSON.parse(readFileSync(file, "utf8")), url: DEFAULT_SOURCE };
}

function build(index, source) {
  if (!isObj(index) || index.schemaVersion !== 1) fail("index.json: schemaVersion must be 1");
  const p = index.period;
  if (!isObj(p) || !isDate(p.from) || !isDate(p.to) || !isCount(p.days) || p.from > p.to) {
    fail("index.json: bad period");
  }
  if (!Array.isArray(index.rigs) || !Array.isArray(index.runs) || !Array.isArray(index.hosts)) {
    fail("index.json: rigs, runs and hosts must be arrays");
  }
  if (typeof index.generatedAt !== "string" || Number.isNaN(Date.parse(index.generatedAt))) {
    fail("index.json: bad generatedAt");
  }
  if (index.hosts.length > MAX_HOSTS) fail(`index.json: more than ${MAX_HOSTS} hosts`);

  // Per host: distinct runs and per-site counts, from the contact rows.
  const runsByHost = new Map();
  const siteCount = new Map();
  for (const c of Array.isArray(index.contacts) ? index.contacts : []) {
    if (!isObj(c) || !Array.isArray(c.hostnames)) continue;
    for (const host of c.hostnames) {
      if (!runsByHost.has(host)) runsByHost.set(host, new Set());
      runsByHost.get(host).add(`${c.date}|${c.rig}|${c.slug}`);
      const sites = siteCount.get(host) ?? new Map();
      sites.set(c.site, (sites.get(c.site) ?? 0) + 1);
      siteCount.set(host, sites);
    }
  }

  const hosts = index.hosts.map((h, i) => {
    const where = `hosts[${i}]`;
    if (!isObj(h)) fail(`${where} is not an object`);
    const bad = hostProblem(h.host);
    if (bad) fail(`${where}.host ${bad}: ${String(h.host)}`);
    if (!isDate(h.first) || !isDate(h.last) || h.first > h.last) fail(`${where}: bad dates`);
    for (const k of ["days", "variants", "sites", "rigs"]) {
      if (!Array.isArray(h[k])) fail(`${where}.${k} must be an array`);
    }
    for (const d of h.days) if (!isDate(d)) fail(`${where}.days has a bad date`);
    for (const s of h.sites) {
      const sb = hostProblem(s);
      if (sb) fail(`${where}.sites ${sb}: ${String(s)}`);
    }
    const counts = siteCount.get(h.host) ?? new Map();
    const sites = [...new Set(h.sites)]
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, MAX_SITES);
    return {
      host: h.host,
      first: h.first,
      last: h.last,
      days: new Set(h.days).size,
      runs: runsByHost.get(h.host)?.size ?? 0,
      sites,
      variants: new Set(h.variants).size,
      rigs: new Set(h.rigs).size,
    };
  });
  hosts.sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  if (new Set(hosts.map((h) => h.host)).size !== hosts.length) fail("duplicate hosts");

  return {
    schemaVersion: 1,
    source,
    generatedAt: index.generatedAt,
    period: { from: p.from, to: p.to, days: p.days },
    rigs: index.rigs.length,
    runs: index.runs.length,
    hosts,
  };
}

const { index, url } = await readIndex(from);
const snapshot = build(index, url);
const text = `${JSON.stringify(snapshot, null, 2)}\n`;

if (check) {
  const current = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  const strip = (s) => JSON.stringify({ ...s, generatedAt: null });
  if (current && strip(current) === strip(snapshot)) {
    console.log("observatory snapshot: up to date");
  } else {
    console.error("observatory snapshot: differs from the source; run `pnpm observatory:snapshot`");
    process.exit(1);
  }
} else {
  writeFileSync(OUT, text);
  console.log(
    `observatory snapshot: ${snapshot.hosts.length} host(s), ${snapshot.runs} run(s), ` +
      `${snapshot.period.from}..${snapshot.period.to} -> ${OUT}`,
  );
}
