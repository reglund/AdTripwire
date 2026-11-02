#!/usr/bin/env node
/**
 * Keeps the curated indicator set current with the upstream Zero Breach list (CC0 1.0).
 *
 *   node scripts/refresh-indicators.mjs            fetch, verify, and if changed: update the
 *                                                  vendored files, regenerate the set and feeds
 *   node scripts/refresh-indicators.mjs --check    fetch and compare only (no writes)
 *   options: --summary=<file.md>  write a Markdown change summary (used for the PR body)
 *
 * Exit codes: 0 up to date, 10 changed (files updated unless --check), 3 rows need a curation
 * decision (unknown source/tier), 1 error (download, checksum or validation failure).
 * Only public GitHub raw files are fetched; no indicator host is ever contacted.
 */
/* global fetch */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RAW = "https://raw.githubusercontent.com/interplains/zero-breach/main";
const FILES = {
  iocs: {
    url: `${RAW}/iocs/adfection_iocs.txt`,
    local: "packages/indicators/upstream/zero-breach/adfection_iocs.txt",
  },
  sha: { url: `${RAW}/iocs/adfection_iocs.txt.sha256` },
  withdrawals: {
    url: `${RAW}/dist/adfection.withdrawals.stix.json`,
    local: "packages/indicators/upstream/zero-breach/adfection.withdrawals.stix.json",
  },
  license: {
    url: `${RAW}/iocs/LICENSE.md`,
    local: "packages/indicators/upstream/zero-breach/LICENSE.md",
  },
};
const SET = "packages/indicators/data/adfection-2026.json";
const check = process.argv.includes("--check");
const summaryPath = process.argv
  .find((a) => a.startsWith("--summary="))
  ?.slice("--summary=".length);

async function get(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const key = (r) => `${r.indicatorType}|${r.indicator}|${r.pathPattern ?? ""}`;

function diffSets(before, after) {
  const a = new Map(before.indicators.map((r) => [key(r), r]));
  const b = new Map(after.indicators.map((r) => [key(r), r]));
  const added = [...b.values()].filter((r) => !a.has(key(r)));
  const removed = [...a.values()].filter((r) => !b.has(key(r)));
  const changed = [...b.values()].filter((r) => {
    const o = a.get(key(r));
    return (
      o &&
      (o.classification !== r.classification || o.validTo !== r.validTo || o.enabled !== r.enabled)
    );
  });
  return { added, removed, changed };
}

async function main() {
  const iocs = await get(FILES.iocs.url);
  const shaLine = (await get(FILES.sha.url)).toString("utf8").trim();
  const expected = /^([0-9a-f]{64})\b/.exec(shaLine)?.[1];
  if (!expected) throw new Error("upstream checksum file is malformed");
  if (sha256(iocs) !== expected)
    throw new Error("upstream IOC file does not match its published SHA-256");
  const withdrawals = await get(FILES.withdrawals.url);
  JSON.parse(withdrawals.toString("utf8")); // must be JSON
  const license = await get(FILES.license.url);

  const same = (f, buf) => existsSync(f.local) && readFileSync(f.local).equals(buf);
  const upstreamChanged = !same(FILES.iocs, iocs) || !same(FILES.withdrawals, withdrawals);
  const asOf = /^#\s*as-of:\s*(\S+)/m.exec(iocs.toString("utf8"))?.[1] ?? "unknown";
  if (!upstreamChanged) {
    console.log(
      `indicators up to date with upstream (as-of ${asOf}, sha256 ${expected.slice(0, 12)}…)`,
    );
    return 0;
  }
  console.log(`upstream changed (as-of ${asOf}, sha256 ${expected.slice(0, 12)}…)`);
  if (check) return 10;

  const before = JSON.parse(readFileSync(SET, "utf8"));
  writeFileSync(FILES.iocs.local, iocs);
  writeFileSync(FILES.withdrawals.local, withdrawals);
  writeFileSync(FILES.license.local, license);
  try {
    execFileSync(
      "node",
      ["scripts/import-zero-breach.mjs", `--withdrawals=${FILES.withdrawals.local}`, "--strict"],
      { stdio: "inherit" },
    );
  } catch (err) {
    if (err.status === 3) {
      console.error("new upstream rows need a curation decision in scripts/import-zero-breach.mjs");
      writeSummary(asOf, null, true);
      return 3;
    }
    throw err;
  }
  execFileSync("node", ["scripts/validate-indicators.mjs"], { stdio: "inherit" });
  execFileSync("node", ["scripts/export-feeds.mjs"], { stdio: "inherit" });
  const after = JSON.parse(readFileSync(SET, "utf8"));
  const d = diffSets(before, after);
  console.log(
    `set ${before.meta.version} → ${after.meta.version}: +${d.added.length} −${d.removed.length} ~${d.changed.length}`,
  );
  writeSummary(asOf, { before, after, ...d }, false);
  return 10;
}

function writeSummary(asOf, d, needsCuration) {
  if (!summaryPath) return;
  const L = [`Automated refresh from Zero Breach (upstream as-of ${asOf}).`, ""];
  if (needsCuration) {
    L.push("**The upstream list contains rows with an unknown source or tier.** The import was");
    L.push(
      "stopped: add a curation decision to `scripts/import-zero-breach.mjs` (see the job log).",
    );
  } else {
    L.push(
      `Curated set ${d.before.meta.version} → ${d.after.meta.version}: ${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed.`,
    );
    L.push("");
    const fmt = (r) =>
      `- \`${r.indicatorType}\` ${r.indicator}${r.pathPattern ?? ""} (${r.classification})`;
    if (d.added.length) L.push("Added:", "", ...d.added.slice(0, 100).map(fmt), "");
    if (d.removed.length) L.push("Removed:", "", ...d.removed.slice(0, 100).map(fmt), "");
    if (d.changed.length) L.push("Changed:", "", ...d.changed.slice(0, 100).map(fmt), "");
    L.push("Review checklist (CONTRIBUTING → Indicator review process):", "");
    L.push("- [ ] classifications are the most conservative the sources support");
    L.push("- [ ] rotated infrastructure has a validity window");
    L.push(
      "- [ ] after merge: `pnpm indicators:sign sign …` to publish a signed bundle for existing installs",
    );
  }
  writeFileSync(summaryPath, L.join("\n") + "\n");
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
