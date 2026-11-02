#!/usr/bin/env node
// Dependency-free validation of the bundled and synthetic indicator sets.
// Mirrors the rules in packages/indicators/src/validate.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const FILES = {
  real: `${root}packages/indicators/data/adfection-2026.json`,
  synthetic: `${root}tests/fixtures/indicators/synthetic.json`,
};

const BROAD = [
  "cloudfront.net",
  "amazonaws.com",
  "azure.com",
  "herokuapp.com",
  "cloudapp.azure.com",
  "github.io",
  "googleapis.com",
  "akamaihd.net",
  "edgekey.net",
  "fastly.net",
  "netlify.app",
  "vercel.app",
  "web.app",
  "firebaseapp.com",
];
const TYPES = ["hostname", "domain", "url_path", "hostname_path"];
const CLASSES = ["malicious", "surveillance", "contextual"];
const CONFIDENCES = ["low", "medium", "high"];
const RESERVED = /(^|\.)(test|invalid|example|localhost)$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

const UNICODE_HOST_CHARS = /^[a-z0-9._\-\u0080-\uffff]+$/;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.trim().length > 0;
function isDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function normalize(input) {
  if (typeof input !== "string" || input.length === 0 || /\s/.test(input)) return null;
  let h = input.replace(/\[\.\]/g, ".");
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  h = h.toLowerCase();
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h.length === 0) return null;
  if (h.includes(":")) {
    if (!/^[0-9a-f:.]+$/.test(h) || h.split(":").length < 3) return null;
    try {
      return new URL(`http://[${h}]/`).hostname.replace(/^\[|\]$/g, "");
    } catch {
      return null;
    }
  }
  if (/[\u0080-\uffff]/.test(h)) {
    if (!UNICODE_HOST_CHARS.test(h)) return null;
    try {
      h = new URL(`https://${h}`).hostname;
    } catch {
      return null;
    }
    if (h.endsWith(".")) h = h.slice(0, -1);
  }
  if (h.length > 253 || !/^[a-z0-9._-]+$/.test(h)) return null;
  return h.split(".").every((l) => l.length > 0 && l.length <= 63) ? h : null;
}
const isIp = (h) => IPV4.test(h) || h.includes(":");

function validateSet(set, errors, label) {
  const err = (m) => errors.push(`${label}: ${m}`);
  if (!isObj(set)) return err("not an object");
  const m = set.meta;
  if (!isObj(m)) err("meta missing");
  else {
    for (const k of ["id", "name", "version", "license"])
      if (!isStr(m[k])) err(`meta.${k} required`);
    if (!isDate(m.asOf)) err("meta.asOf must be YYYY-MM-DD");
    if (typeof m.synthetic !== "boolean") err("meta.synthetic must be boolean");
    if (!Array.isArray(m.sources)) err("meta.sources must be an array");
    else
      m.sources.forEach((s, i) => {
        if (!isObj(s) || !isStr(s.name) || !isStr(s.url) || !isDate(s.published))
          err(`meta.sources[${i}] invalid`);
      });
  }
  if (!Array.isArray(set.indicators)) return err("indicators must be an array");
  const seen = new Set();
  set.indicators.forEach((r, i) => {
    if (!isObj(r)) return err(`indicators[${i}] not an object`);
    const e = (msg) => err(`indicators[${i}] (${r.id}): ${msg}`);
    for (const k of ["id", "source", "sourceUrl", "campaign"]) if (!isStr(r[k])) e(`${k} required`);
    if (seen.has(r.id)) e("duplicate id");
    seen.add(r.id);
    if (!TYPES.includes(r.indicatorType)) e("bad indicatorType");
    if (!CLASSES.includes(r.classification)) e("bad classification");
    if (!CONFIDENCES.includes(r.confidence)) e("bad confidence");
    if (!isDate(r.firstReported)) e("firstReported must be YYYY-MM-DD");
    if (!isDate(r.lastReviewed)) e("lastReviewed must be YYYY-MM-DD");
    for (const k of ["validFrom", "validTo"])
      if (r[k] !== undefined && !isDate(r[k])) e(`${k} must be YYYY-MM-DD when present`);
    if (isDate(r.validFrom) && isDate(r.validTo) && r.validFrom > r.validTo)
      e("validFrom must not be after validTo");
    if (typeof r.enabled !== "boolean") e("enabled must be boolean");
    if (typeof r.indicator !== "string" || r.indicator.length === 0) return e("indicator required");
    if (r.indicatorType === "url_path") {
      if (!r.indicator.startsWith("/")) e('url_path indicator must start with "/"');
    } else if (TYPES.includes(r.indicatorType)) {
      const h = normalize(r.indicator);
      if (h === null) e(`"${r.indicator}" is not a valid hostname`);
      else if (isIp(h)) e("IP addresses are not allowed");
      else if (!h.includes(".")) e(`"${h}" must contain a dot`);
      else if (BROAD.includes(h)) e(`"${h}" is too broad`);
    }
    if (r.indicatorType === "hostname_path" || r.indicatorType === "url_path") {
      if (typeof r.pathPattern !== "string" || !r.pathPattern.startsWith("/"))
        e('pathPattern required, must start with "/"');
    }
  });
}

const failures = [];
const loaded = {};
for (const [name, file] of Object.entries(FILES)) {
  try {
    loaded[name] = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    failures.push(`${name}: cannot read/parse ${file}: ${cause.message}`);
  }
}

for (const name of Object.keys(loaded)) validateSet(loaded[name], failures, name);

const nameOf = (r) =>
  typeof r.indicator === "string"
    ? r.indicator
        .replace(/\[\.\]/g, ".")
        .toLowerCase()
        .replace(/\.$/, "")
    : "";
if (loaded.real?.meta?.synthetic !== false) failures.push("real: meta.synthetic must be false");
if (loaded.synthetic?.meta?.synthetic !== true)
  failures.push("synthetic: meta.synthetic must be true");
for (const r of loaded.real?.indicators ?? []) {
  if (isObj(r) && (RESERVED.test(nameOf(r)) || nameOf(r) === "localhost")) {
    failures.push(`real: ${r.id} uses reserved name "${r.indicator}"`);
  }
}
for (const r of loaded.synthetic?.indicators ?? []) {
  if (isObj(r) && r.indicatorType !== "url_path" && !RESERVED.test(nameOf(r))) {
    failures.push(
      `synthetic: ${r.id} "${r.indicator}" is not a reserved name (.test/.invalid/.example/.localhost)`,
    );
  }
}

if (failures.length > 0) {
  console.error(`Indicator validation FAILED (${failures.length} problem(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

for (const [name, set] of Object.entries(loaded)) {
  const counts = { malicious: 0, surveillance: 0, contextual: 0 };
  let enabled = 0;
  for (const r of set.indicators) {
    counts[r.classification]++;
    if (r.enabled) enabled++;
  }
  console.log(
    `${name} (${set.meta.id}): ${set.indicators.length} indicators, ${enabled} enabled — ` +
      `malicious ${counts.malicious}, surveillance ${counts.surveillance}, contextual ${counts.contextual}`,
  );
}
console.log("Indicator validation OK");
