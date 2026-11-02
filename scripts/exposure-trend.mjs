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
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const arg = (k, d) =>
  (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const expand = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const DIR = expand(arg("dir", "~/.cache/adtripwire-exposure"));
const OUT = expand(arg("out", join(DIR, "trend.md")));

if (!existsSync(DIR)) {
  console.error(`no directory ${DIR}`);
  process.exit(2);
}
const runs = [];
for (const f of readdirSync(DIR)
  .filter((n) => n.endsWith(".json"))
  .sort()) {
  try {
    const j = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    if (!j || !Array.isArray(j.results) || !j.date || !j.browser) continue;
    runs.push({
      file: f,
      ...j,
      variant: `${j.browser}${j.device ? ` / ${j.device}` : j.mobile ? " / mobile" : ""}`,
    });
  } catch {
    /* skip unreadable files */
  }
}
runs.sort((a, b) => (a.date + a.variant).localeCompare(b.date + b.variant));

const SEV = ["high_priority", "elevated", "suspicious", "informational"];
const L = [];
L.push("# AdTripwire exposure trend");
L.push("");
L.push(
  `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from ${runs.length} run(s) in \`${DIR.replace(homedir(), "~")}\`.`,
);
L.push("");
if (runs.length === 0) {
  L.push("No runs yet.");
  writeFileSync(OUT, L.join("\n") + "\n");
  console.log(`trend → ${OUT} (no runs)`);
  process.exit(0);
}
const days = [...new Set(runs.map((r) => r.date))];
L.push(`Period: ${days[0]} – ${days[days.length - 1]} (${days.length} day(s)).`);
L.push("");

// Documented-infrastructure contacts.
const contacts = [];
for (const r of runs)
  for (const row of r.results)
    for (const d of row.detections ?? [])
      if (
        d.ruleId.startsWith("known_infra.") ||
        d.ruleId.startsWith("correlation.") ||
        ["elevated", "high_priority"].includes(d.severity)
      )
        contacts.push({ date: r.date, variant: r.variant, site: row.site, ...d });

L.push("## Signals that matter");
L.push("");
if (contacts.length === 0)
  L.push("No contact with documented infrastructure and nothing at elevated or above in any run.");
else {
  L.push("| Date | Variant | Site | Rule | Severity | Hosts |");
  L.push("|---|---|---|---|---|---|");
  for (const c of contacts)
    L.push(
      `| ${c.date} | ${c.variant} | ${c.site} | \`${c.ruleId}\` | ${c.severity} | ${c.hostnames ? c.hostnames.join(", ") : "(not recorded in this run)"} |`,
    );
}
L.push("");

// Cumulative documented hosts.
const hosts = new Map();
for (const c of contacts)
  for (const h of c.hostnames ?? []) {
    const e = hosts.get(h) ?? {
      first: c.date,
      last: c.date,
      days: new Set(),
      variants: new Set(),
      sites: new Set(),
    };
    e.first = c.date < e.first ? c.date : e.first;
    e.last = c.date > e.last ? c.date : e.last;
    e.days.add(c.date);
    e.variants.add(c.variant);
    e.sites.add(c.site);
    hosts.set(h, e);
  }
if (hosts.size) {
  L.push("## Documented hosts seen");
  L.push("");
  L.push("| Host | First seen | Last seen | Days | Variants | Sites |");
  L.push("|---|---|---|---:|---|---|");
  for (const [h, e] of [...hosts].sort((a, b) => b[1].days.size - a[1].days.size))
    L.push(
      `| ${h} | ${e.first} | ${e.last} | ${e.days.size} | ${[...e.variants].join(", ")} | ${[...e.sites].join(", ")} |`,
    );
  L.push("");
}

L.push("## Runs");
L.push("");
L.push(
  "| Date | Variant | Sites loaded | Consent clicked | Requests | Median 3rd-party domains | " +
    SEV.join(" | ") +
    " |",
);
L.push("|---|---|---:|---:|---:|---:|" + SEV.map(() => "---:").join("|") + "|");
for (const r of runs) {
  const loaded = r.results.filter((x) => x.loaded);
  const tp = loaded
    .map((x) => x.thirdPartyDomains)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const med = tp.length ? tp[Math.floor(tp.length / 2)] : "—";
  const bySev = Object.fromEntries(SEV.map((s) => [s, 0]));
  for (const x of r.results)
    for (const d of x.detections ?? []) bySev[d.severity] = (bySev[d.severity] ?? 0) + 1;
  const req = r.results.reduce((a, x) => a + (x.events > 0 ? x.events : 0), 0);
  L.push(
    `| ${r.date} | ${r.variant} | ${loaded.length}/${r.results.length} | ${r.results.filter((x) => x.consent).length} | ${req} | ${med} | ${SEV.map((s) => bySev[s]).join(" | ")} |`,
  );
}
L.push("");
L.push("## Reading this");
L.push("");
L.push(
  "- Contacts with documented infrastructure show exposure to the ad-delivery path described in public reporting; they do not show targeting or anything delivered to a device. Selective responses, validator or C2 contact and correlated chains would be the stronger signals.",
);
L.push(
  "- Runs before 2026-11-03 used the pre-retune redirect_chain rule and an unreliable third-party counter; compare severities and counts from later runs only.",
);
L.push(
  "- Absence of signals means the automated profiles were not shown the documented infrastructure in these auctions; it says nothing about other profiles or devices.",
);
writeFileSync(OUT, L.join("\n") + "\n");
console.log(
  `trend → ${OUT} (${runs.length} runs, ${days.length} days, ${contacts.length} signal(s))`,
);
