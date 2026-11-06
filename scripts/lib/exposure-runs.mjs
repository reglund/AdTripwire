/**
 * Shared reading of the daily exposure runs written by scripts/exposure-run.mjs (--json).
 * Used by scripts/exposure-trend.mjs (Markdown trend) and scripts/observatory-build.mjs
 * (static site). Pure functions except loadRuns, which reads a directory.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const SEV = ["high_priority", "elevated", "suspicious", "informational"];

// Rules that fire on ordinary ad slots in nearly every run and would otherwise dominate the
// per-severity counts. They are counted in their own column instead of by severity.
export const NOISY_RULES = new Set(["page.hidden_iframe_after_load"]);

/** Human-readable variant label: browser, device or mobile, ETP, non-default site list. */
export function variantOf(j) {
  return (
    `${j.browser}${j.device ? ` / ${j.device}` : j.mobile ? " / mobile" : ""}` +
    `${j.etpOff ? " / ETP off" : ""}` +
    `${
      j.sites && !/exposure-sites\.txt$/.test(j.sites)
        ? ` / ${String(j.sites)
            .split("/")
            .pop()
            .replace(/\.txt$/, "")}`
        : ""
    }`
  );
}

/** File-name-safe variant id, e.g. chromium-pixel-5 or firefox-etp-off-yandex-ad-sites. */
export function variantSlug(run) {
  return variantOf(run)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** True for a real calendar day written as YYYY-MM-DD. */
export function validDate(d) {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** Every run JSON in dir (skips malformed files and evidence exports), sorted by date+variant. */
export function loadRuns(dir) {
  const runs = [];
  if (!existsSync(dir)) return runs;
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".json") && !n.endsWith(".evidence.json"))
    .sort()) {
    try {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (!j || !Array.isArray(j.results) || !j.browser || !validDate(j.date)) continue;
      runs.push({ file: f, ...j, variant: variantOf(j) });
    } catch {
      /* skip unreadable files */
    }
  }
  runs.sort((a, b) => (a.date + a.variant).localeCompare(b.date + b.variant));
  return runs;
}

/** Detections that count as a contact: documented infrastructure, correlations, elevated+. */
export function contactsOf(runs) {
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
  return contacts;
}

/** Contacts that are stronger than plain contact with documented infrastructure. */
export function isStrong(c) {
  return c.ruleId.startsWith("correlation.") || ["elevated", "high_priority"].includes(c.severity);
}

/** Cumulative table of documented hosts, most days first. Arrays keep first-seen order. */
export function hostTable(contacts) {
  const hosts = new Map();
  for (const c of contacts)
    for (const h of c.hostnames ?? []) {
      const e = hosts.get(h) ?? {
        host: h,
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
  return [...hosts.values()]
    .sort((a, b) => b.days.size - a.days.size)
    .map((e) => ({
      host: e.host,
      first: e.first,
      last: e.last,
      days: [...e.days],
      variants: [...e.variants],
      sites: [...e.sites],
    }));
}

/** Per-run numbers shown in the trend table. median is a number or "—". */
export function runStats(r) {
  const loaded = r.results.filter((x) => x.loaded);
  const tp = loaded
    .map((x) => x.thirdPartyDomains)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const median = tp.length ? tp[Math.floor(tp.length / 2)] : "—";
  const bySev = Object.fromEntries(SEV.map((s) => [s, 0]));
  let noisy = 0;
  for (const x of r.results)
    for (const d of x.detections ?? []) {
      if (NOISY_RULES.has(d.ruleId)) noisy += 1;
      else bySev[d.severity] = (bySev[d.severity] ?? 0) + 1;
    }
  return {
    loaded: loaded.length,
    total: r.results.length,
    consent: r.results.filter((x) => x.consent).length,
    requests: r.results.reduce((a, x) => a + (x.events > 0 ? x.events : 0), 0),
    median,
    bySev,
    noisy,
  };
}

/** The "Reading this" notes, shared by the Markdown trend and the site's limitations section. */
export function readingNotes() {
  return [
    "Contacts with documented infrastructure show exposure to the ad-delivery path described in public reporting; they do not show targeting or anything delivered to a device. Selective responses, validator or C2 contact and correlated chains would be the stronger signals.",
    "Runs before 2026-11-03 used the pre-retune redirect_chain rule and an unreliable third-party counter; compare severities and counts from later runs only.",
    `The severity columns leave out ${[...NOISY_RULES].map((r) => `\`${r}\``).join(", ")}: it fires on ordinary ad slots on most sites and is counted separately under "Hidden iframes". Any of those detections that is elevated or above still appears under "Signals that matter".`,
    "Absence of signals means the automated profiles were not shown the documented infrastructure in these auctions; it says nothing about other profiles or devices.",
  ];
}

/** Markdown trend report (the content of trend.md). */
export function renderTrendMarkdown(runs, { dirLabel, now = new Date() }) {
  const L = [];
  L.push("# AdTripwire exposure trend");
  L.push("");
  L.push(
    `Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC from ${runs.length} run(s) in \`${dirLabel}\`.`,
  );
  L.push("");
  if (runs.length === 0) {
    L.push("No runs yet.");
    return L.join("\n") + "\n";
  }
  const days = [...new Set(runs.map((r) => r.date))];
  L.push(`Period: ${days[0]} – ${days[days.length - 1]} (${days.length} day(s)).`);
  L.push("");

  const contacts = contactsOf(runs);
  L.push("## Signals that matter");
  L.push("");
  if (contacts.length === 0)
    L.push(
      "No contact with documented infrastructure and nothing at elevated or above in any run.",
    );
  else {
    L.push("| Date | Variant | Site | Rule | Severity | Hosts |");
    L.push("|---|---|---|---|---|---|");
    for (const c of contacts)
      L.push(
        `| ${c.date} | ${c.variant} | ${c.site} | \`${c.ruleId}\` | ${c.severity} | ${c.hostnames ? c.hostnames.join(", ") : "(not recorded in this run)"} |`,
      );
  }
  L.push("");

  const hosts = hostTable(contacts);
  if (hosts.length) {
    L.push("## Documented hosts seen");
    L.push("");
    L.push("| Host | First seen | Last seen | Days | Variants | Sites |");
    L.push("|---|---|---|---:|---|---|");
    for (const e of hosts)
      L.push(
        `| ${e.host} | ${e.first} | ${e.last} | ${e.days.length} | ${e.variants.join(", ")} | ${e.sites.join(", ")} |`,
      );
    L.push("");
  }

  L.push("## Runs");
  L.push("");
  L.push(
    "| Date | Variant | Sites loaded | Consent clicked | Requests | Median 3rd-party domains | " +
      SEV.join(" | ") +
      " | Hidden iframes |",
  );
  L.push("|---|---|---:|---:|---:|---:|" + SEV.map(() => "---:").join("|") + "|---:|");
  for (const r of runs) {
    const s = runStats(r);
    L.push(
      `| ${r.date} | ${r.variant} | ${s.loaded}/${s.total} | ${s.consent} | ${s.requests} | ${s.median} | ${SEV.map((k) => s.bySev[k]).join(" | ")} | ${s.noisy} |`,
    );
  }
  L.push("");
  L.push("## Reading this");
  L.push("");
  for (const n of readingNotes()) L.push(`- ${n}`);
  return L.join("\n") + "\n";
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Deep copy with the rig's home directory and login name removed from every string:
 * `home` and `/home/<user>` become `~`. A bare user name elsewhere (for example a `/art/` URL
 * path in evidence) is left alone. Numbers, booleans and null are returned unchanged.
 */
export function scrub(value, { home, user } = {}) {
  const homes = [...new Set([home, user ? `/home/${user}` : ""].filter(Boolean))]
    .map((h) => h.replace(/[\\/]+$/, ""))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const homeRe = homes.length
    ? new RegExp(`(?:${homes.map(escRe).join("|")})(?=[\\\\/]|$|[^A-Za-z0-9._-])`, "g")
    : null;
  const one = (s) => {
    let t = s;
    if (homeRe) t = t.replace(homeRe, "~");
    return t;
  };
  const walk = (v) => {
    if (typeof v === "string") return one(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}
