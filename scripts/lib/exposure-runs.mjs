/**
 * Shared reading of the daily exposure runs written by scripts/exposure-run.mjs (--json).
 * Used by scripts/exposure-trend.mjs (Markdown trend) and scripts/observatory-build.mjs
 * (static site). Pure functions except loadRuns, which reads a directory.
 */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

export const SEV = ["high_priority", "elevated", "suspicious", "informational"];

// Rules that fire on ordinary ad slots in nearly every run and would otherwise dominate the
// per-severity counts. They are counted in their own column instead of by severity.
export const NOISY_RULES = new Set(["page.hidden_iframe_after_load"]);

/** Rig (measurement machine) names: lower case letters, digits and hyphens, 1-32 characters. */
export const RIG_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const DEFAULT_RIG = "rig-1";
export const RIG_NETWORKS = ["home", "mobile", "office", "datacentre"];

/** True for a usable rig name. */
export const validRigName = (n) => typeof n === "string" && RIG_NAME_RE.test(n);

/** The rig of a run: its own valid `rig` field, else the default rig. */
export const rigOf = (run) => (validRigName(run?.rig) ? run.rig : DEFAULT_RIG);

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

/** Largest file the observatory reads from a rig directory, in bytes. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Most runs taken from one rig directory (the newest by date). */
// 400 calendar days on the page times up to ten variants a day.
export const MAX_RUNS_PER_RIG = 4000;

/** True when path is a real directory (not a symbolic link to one). A missing path is false. */
export function isRealDir(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The text of a regular file no larger than maxBytes, else null. A symbolic link, a directory, a
 * special file, a larger file and a missing file all give null; onSkip() is called for each of
 * them except the missing one. The file is opened with O_NOFOLLOW and checked again after the
 * open, so a link swapped in after the first look is refused too.
 */
export function readRegularFile(path, { maxBytes = MAX_FILE_BYTES, onSkip } = {}) {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size > maxBytes) {
    onSkip?.();
    return null;
  }
  try {
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const again = fstatSync(fd);
      if (!again.isFile() || again.size > maxBytes) {
        onSkip?.();
        return null;
      }
      return readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    onSkip?.();
    return null;
  }
}

/** Caps on the per-site "seen alongside" fields; the harness truncates to them, the reader enforces them. */
export const ALONGSIDE_MAX_ENTRIES = 200;
export const THIRD_PARTY_LIST_MAX = 1000;
export const ALONGSIDE_ANCHORS_MAX = 1_000_000;
/** Most repeat contacts kept per site row. */
export const REPEAT_CONTACTS_MAX = 200;

/** A bare hostname: no scheme, path, query or port. Applied to every published host. */
export const HOSTNAME_RE = /^[a-z0-9]([a-z0-9._-]{0,251}[a-z0-9])?$/;
/** An indicator id, or the indicator's hostname when the harness could resolve it. */
const ANCHOR_RE = /^[A-Za-z0-9._:-]{1,253}$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Valid optional `alongside`, `thirdPartyDomainsList`, `alongsideAnchors` and `repeatContacts` of one result row. */
function validAlongsideFields(row) {
  if (row.alongside !== undefined) {
    if (!Array.isArray(row.alongside) || row.alongside.length > ALONGSIDE_MAX_ENTRIES) return false;
    const ok = row.alongside.every(
      (a) =>
        isObject(a) &&
        typeof a.host === "string" &&
        HOSTNAME_RE.test(a.host) &&
        typeof a.anchor === "string" &&
        ANCHOR_RE.test(a.anchor) &&
        (a.scope === "frame" || a.scope === "page"),
    );
    if (!ok) return false;
  }
  if (row.thirdPartyDomainsList !== undefined) {
    const l = row.thirdPartyDomainsList;
    if (
      !Array.isArray(l) ||
      l.length > THIRD_PARTY_LIST_MAX ||
      !l.every((d) => typeof d === "string" && HOSTNAME_RE.test(d))
    )
      return false;
  }
  if (row.alongsideAnchors !== undefined) {
    const n = row.alongsideAnchors;
    if (!Number.isInteger(n) || n < 0 || n > ALONGSIDE_ANCHORS_MAX) return false;
  }
  if (row.repeatContacts !== undefined) {
    const l = row.repeatContacts;
    if (
      !Array.isArray(l) ||
      l.length > REPEAT_CONTACTS_MAX ||
      !l.every(
        (d) =>
          isObject(d) &&
          typeof d.ruleId === "string" &&
          typeof d.severity === "string" &&
          (d.hostnames === undefined ||
            (Array.isArray(d.hostnames) &&
              d.hostnames.every((h) => typeof h === "string" && HOSTNAME_RE.test(h)))),
      )
    )
      return false;
  }
  return true;
}

/**
 * True when a run has the shape the readers below rely on: an object whose `results` are objects
 * with a string `site`, whose `detections` (when present) are arrays of objects with string
 * `ruleId` and `severity`, and whose `hostnames` (when present) are arrays of strings. The
 * optional "seen alongside" fields (`alongside`, `thirdPartyDomainsList`, `alongsideAnchors`)
 * must be well-formed, hostname-only and length-capped when present.
 */
export function validRunShape(j) {
  if (!isObject(j) || typeof j.browser !== "string" || !j.browser || !Array.isArray(j.results))
    return false;
  return j.results.every((row) => {
    if (!isObject(row) || typeof row.site !== "string") return false;
    if (!validAlongsideFields(row)) return false;
    if (row.detections === undefined) return true;
    return (
      Array.isArray(row.detections) &&
      row.detections.every(
        (d) =>
          isObject(d) &&
          typeof d.ruleId === "string" &&
          typeof d.severity === "string" &&
          (d.hostnames === undefined ||
            (Array.isArray(d.hostnames) && d.hostnames.every((h) => typeof h === "string"))),
      )
    );
  });
}

/**
 * Every run JSON in dir (skips malformed files, evidence exports, anything that is not a regular
 * file, and runs that fail validRunShape), sorted by date+variant. Options: maxBytes (skip larger
 * files; no limit when absent), maxRuns (keep only the newest this many), onSkip (called once per
 * entry that was left out).
 */
export function loadRuns(dir, { maxBytes = Infinity, maxRuns = Infinity, onSkip } = {}) {
  const runs = [];
  if (!existsSync(dir)) return runs;
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.name.endsWith(".json") && !e.name.endsWith(".evidence.json"))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of names) {
    if (!e.isFile()) {
      onSkip?.();
      continue;
    }
    const text = readRegularFile(join(dir, e.name), { maxBytes, ...(onSkip ? { onSkip } : {}) });
    if (text === null) continue;
    try {
      const j = JSON.parse(text);
      if (!validRunShape(j) || !validDate(j.date)) {
        onSkip?.();
        continue;
      }
      runs.push({ ...j, file: e.name, variant: variantOf(j) });
    } catch {
      onSkip?.();
    }
  }
  runs.sort((a, b) => (a.date + a.variant).localeCompare(b.date + b.variant));
  if (runs.length > maxRuns) {
    onSkip?.(runs.length - maxRuns);
    return runs.slice(runs.length - maxRuns);
  }
  return runs;
}

/** True for a detection that counts as a contact: documented infrastructure, correlations, elevated+. */
export function isContactDetection(d) {
  return (
    typeof d?.ruleId === "string" &&
    (d.ruleId.startsWith("known_infra.") ||
      d.ruleId.startsWith("correlation.") ||
      ["elevated", "high_priority"].includes(d.severity))
  );
}

/**
 * Repeat contacts a run recorded before `repeatContacts` existed, reconstructed from "seen
 * alongside": a site that opened documented-host anchors (`alongsideAnchors` > 0) without a
 * known_infra detection of its own had its contact merged into an earlier site's detection by the
 * engine's deduplication. The anchor ids resolve to the earlier known_infra detection of the same
 * run that matched them; anchors that resolve to nothing are left out.
 */
function inferredRepeats(r, row, byIndicator) {
  if (Array.isArray(row.repeatContacts) || !(row.alongsideAnchors > 0)) return [];
  const rows = Array.isArray(row.detections) ? row.detections : [];
  if (rows.some((d) => d?.ruleId?.startsWith?.("known_infra."))) return [];
  const out = new Map();
  for (const a of Array.isArray(row.alongside) ? row.alongside : []) {
    const src = byIndicator.get(a.anchor);
    if (src && !out.has(src.detectionId ?? src.ruleId)) out.set(src.detectionId ?? src.ruleId, src);
  }
  return [...out.values()].map((d) => ({
    ruleId: d.ruleId,
    severity: d.severity,
    ...(Array.isArray(d.hostnames) ? { hostnames: d.hostnames } : {}),
  }));
}

/**
 * Contacts: detections that count as a contact (isContactDetection), plus repeat contacts marked
 * `repeat: true` - sites where the engine merged the contact into an earlier site's detection of
 * the same run (deduplication), from `repeatContacts` or, for older runs, reconstructed from
 * "seen alongside" (inferredRepeats).
 */
export function contactsOf(runs) {
  const contacts = [];
  for (const r of runs) {
    const results = Array.isArray(r?.results) ? r.results : [];
    // Indicator id or documented hostname -> the run's known_infra detection that matched it.
    const byIndicator = new Map();
    for (const row of results)
      for (const d of Array.isArray(row?.detections) ? row.detections : [])
        if (d?.ruleId?.startsWith?.("known_infra."))
          for (const k of [
            ...(Array.isArray(d.matchedIndicatorIds) ? d.matchedIndicatorIds : []),
            ...(Array.isArray(d.hostnames) ? d.hostnames : []),
          ])
            if (typeof k === "string" && !byIndicator.has(k)) byIndicator.set(k, d);
    for (const row of results) {
      if (!isObject(row)) continue;
      const base = { date: r.date, variant: r.variant, site: row.site };
      for (const d of Array.isArray(row?.detections) ? row.detections : [])
        if (isContactDetection(d)) contacts.push({ ...base, ...d });
      for (const d of Array.isArray(row?.repeatContacts) ? row.repeatContacts : [])
        if (isContactDetection(d)) contacts.push({ ...base, ...d, repeat: true });
      for (const d of inferredRepeats(r, row, byIndicator))
        contacts.push({ ...base, ...d, repeat: true });
    }
  }
  return contacts;
}

/** Severity text for a contact; repeat contacts say so. */
export const severityText = (c) =>
  c.repeat ? `${c.severity} (repeat contact in the same run)` : c.severity;

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
        rigs: new Set(),
      };
      e.first = c.date < e.first ? c.date : e.first;
      e.last = c.date > e.last ? c.date : e.last;
      e.days.add(c.date);
      e.variants.add(c.variant);
      e.sites.add(c.site);
      if (c.rig) e.rigs.add(c.rig);
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
      rigs: [...e.rigs],
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
    "The profiles do not disguise themselves: desktop Chromium runs present as HeadlessChrome and Firefox runs set navigator.webdriver, so sites and ad exchanges that filter automated visitors may show them fewer or no auctions; the phone emulations present the emulated device's user agent. Each run from 2026-11-07 records what it presented as (`presentation`).",
    `The severity columns leave out ${[...NOISY_RULES].map((r) => `\`${r}\``).join(", ")}: it fires on ordinary ad slots on most sites and is counted separately under "Hidden iframes". Any of those detections that is elevated or above still appears under "Signals that matter".`,
    'Within one run the engine reports a documented host once per correlation window; later sites that contact it again are listed as "repeat contact in the same run" (recorded by the harness from 2026-11-08, reconstructed from seen-alongside anchors for 2026-11-07). Runs before 2026-11-07 cannot show repeats, so they may undercount the sites that carried a host.',
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
        `| ${c.date} | ${c.variant} | ${c.site} | \`${c.ruleId}\` | ${severityText(c)} | ${c.hostnames ? c.hostnames.join(", ") : "(not recorded in this run)"} |`,
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
