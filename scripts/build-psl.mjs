#!/usr/bin/env node
/**
 * Generate packages/indicators/data/public-suffix-list.json from a LOCAL copy of the
 * Public Suffix List (MPL-2.0, https://publicsuffix.org/list/public_suffix_list.dat).
 * This script never fetches anything; it only reads the .dat path given on the command line.
 *
 * Manual refresh:
 *   mkdir -p /tmp/psl && curl -fsSL -o /tmp/psl/public_suffix_list.dat \
 *     https://publicsuffix.org/list/public_suffix_list.dat
 *   node scripts/build-psl.mjs /tmp/psl/public_suffix_list.dat [output.json] [fetchedAt YYYY-MM-DD]
 *   pnpm vitest run packages/indicators
 *
 * Only the ICANN section is kept; the PRIVATE section (github.io, cloudfront.net, ...) is
 * skipped on purpose. Rules are stored in punycode form, comments stripped, in file order.
 * `fetchedAt` defaults to the .dat file's modification date.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error(
    "usage: node scripts/build-psl.mjs <public_suffix_list.dat> [output.json] [fetchedAt]",
  );
  process.exit(2);
}
const output = process.argv[3] ?? "packages/indicators/data/public-suffix-list.json";
const fetchedAt = process.argv[4] ?? statSync(input).mtime.toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(fetchedAt)) {
  console.error(`fetchedAt must be YYYY-MM-DD, got "${fetchedAt}"`);
  process.exit(2);
}

const toAscii = (label) => {
  if (/^[a-z0-9_-]+$/.test(label)) return label;
  // WHATWG URL parsing performs IDNA/punycode conversion without any network access.
  return new URL(`http://${label}`).hostname;
};

let section = "none";
const rules = [];
for (const raw of readFileSync(input, "utf8").split("\n")) {
  const line = raw.trim();
  if (line.startsWith("//")) {
    if (line.includes("===BEGIN ICANN DOMAINS===")) section = "icann";
    else if (line.includes("===BEGIN PRIVATE DOMAINS===")) section = "private";
    else if (line.includes("===END ICANN DOMAINS===") || line.includes("===END PRIVATE DOMAINS==="))
      section = "none";
    continue;
  }
  if (section !== "icann" || line.length === 0) continue;
  // A rule is the first whitespace-delimited token on the line.
  const token = (line.split(/\s+/)[0] ?? "").toLowerCase();
  const prefix = token.startsWith("!") ? "!" : token.startsWith("*.") ? "*." : "";
  const body = token.slice(prefix.length);
  if (body.length === 0 || body.includes("*") || body.includes("!")) {
    console.error(`unexpected rule syntax: "${token}"`);
    process.exit(1);
  }
  rules.push(prefix + body.split(".").map(toAscii).join("."));
}

if (rules.length < 1000 || !rules.includes("com") || !rules.includes("co.uk")) {
  console.error(`suspicious rule set (${rules.length} rules); refusing to write ${output}`);
  process.exit(1);
}

writeFileSync(output, JSON.stringify({ fetchedAt, rules }) + "\n");
console.log(`wrote ${rules.length} ICANN rules to ${output} (fetchedAt ${fetchedAt})`);
