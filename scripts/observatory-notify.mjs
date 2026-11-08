#!/usr/bin/env node
/**
 * Daily notification text for the observatory: what changed in data/index.json since the last
 * notification. Reads the index and a small state file; never touches the network itself.
 *
 *   node scripts/observatory-notify.mjs --index=<site>/data/index.json --state=<file>
 *     [--always] [--dry-run]
 *
 * Delivery: when anything beyond the summary line changed (or with --always) the text is appended
 * to <dir of state>/notifications.log and, when ADTRIPWIRE_NOTIFY_CMD is set, piped to
 * `sh -c "$ADTRIPWIRE_NOTIFY_CMD"` on stdin (the message is never part of the command line). The
 * state is saved (temp file + rename) only after a successful delivery, so a failed one is
 * retried at the next run. With --dry-run the text is printed and nothing is written or run.
 * Exit status: 0, except 2 when the index cannot be read.
 *
 * Besides new hosts, new sites and elevated detections it reports two things from the harness's
 * request outcomes (runs from 2026-11-08): a flow newly marked "worth a closer look" on the site,
 * and a documented host whose requests start or stop getting an answer (for instance a delivery
 * host whose name stopped resolving and resolves again). A state saved before these existed is
 * extended silently, without reporting the current ones as new.
 *
 * A contact is exposure to a documented ad-delivery path. The messages say nothing more.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { STAGES } from "./lib/documented-hosts.mjs";
import { outcomeClass, outcomeLabel } from "./lib/flows.mjs";

const STATE_VERSION = 1;
const INIT_LINE = "Notification state initialised; future runs report changes only.";

/** One line of plain text: control characters collapsed, length bounded. */
const clean = (v) =>
  String(v ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 200);

const arr = (v) => (Array.isArray(v) ? v : []);
const strong = (c) =>
  typeof c.ruleId === "string" &&
  (c.ruleId.startsWith("correlation.") || ["elevated", "high_priority"].includes(c.severity));
const strongKey = (c) => [c.date, c.rig, c.variant, c.site, c.ruleId].join("|");
const uniqSorted = (xs) => [...new Set(xs)].sort();

/** Contacts oldest first, so "first seen" lines name the earliest observation. */
function contactsOf(index) {
  return arr(index.contacts)
    .filter((c) => c && typeof c === "object" && typeof c.date === "string")
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.date < b.c.date ? -1 : a.c.date > b.c.date ? 1 : a.i - b.i))
    .map((x) => x.c);
}

/** "answers" or "silent" for an outcome class; null when it says neither (no recorded end). */
const replyOf = (cls) =>
  ["content", "answered", "redirect", "empty", "http-error"].includes(cls)
    ? "answers"
    : cls === "failed"
      ? "silent"
      : null;

/**
 * Per documented host, how its requests ended on the newest date that recorded an end: "answers"
 * when any request that day got an HTTP answer, else "silent". With the row that shows it.
 */
function repliesOf(index) {
  const best = new Map();
  for (const o of arr(index.outcomes)) {
    if (!o || typeof o.host !== "string" || typeof o.date !== "string") continue;
    const cls = outcomeClass(o);
    const reply = replyOf(cls);
    if (!reply) continue;
    const prev = best.get(o.host);
    if (
      !prev ||
      o.date > prev.row.date ||
      (o.date === prev.row.date && reply === "answers" && prev.reply === "silent")
    )
      best.set(o.host, { reply, cls, row: o });
  }
  return best;
}

const attentionKey = (f) => `${f.host}|${f.site}|${f.outcomeClass}`;
const attentionFlows = (index) =>
  arr(index.flows).filter(
    (f) => f && typeof f.host === "string" && typeof f.site === "string" && f.reading?.attention,
  );

/** The state that describes this index. */
function stateOf(index, contacts) {
  const hosts = {};
  for (const h of arr(index.hosts))
    if (h && typeof h.host === "string") hosts[h.host] = h.first ?? "";
  const pairs = [];
  for (const c of contacts) for (const h of arr(c.hostnames)) pairs.push(`${h}|${c.site}`);
  return {
    version: STATE_VERSION,
    hosts,
    pairs: uniqSorted(pairs),
    strong: uniqSorted(contacts.filter(strong).map(strongKey)),
    replies: Object.fromEntries(
      [...repliesOf(index)].sort(([a], [b]) => (a < b ? -1 : 1)).map(([h, r]) => [h, r.reply]),
    ),
    attention: uniqSorted(attentionFlows(index).map(attentionKey)),
    lastDate: newestDate(index),
  };
}

function newestDate(index) {
  const dates = arr(index.runs)
    .map((r) => r?.date)
    .filter((d) => typeof d === "string");
  return dates.length ? dates.sort()[dates.length - 1] : null;
}

function summaryLine(index, contacts) {
  const latest = newestDate(index);
  if (!latest) return "Observatory: no runs in the index yet.";
  const runs = arr(index.runs).filter((r) => r?.date === latest);
  const today = contacts.filter((c) => c.date === latest);
  const hosts = new Set(today.flatMap((c) => arr(c.hostnames)));
  const rigs = new Set(runs.map((r) => r.rig));
  return `Observatory ${latest}: ${runs.length} run(s), ${today.length} contact(s), ${hosts.size} documented host(s), ${rigs.size} rig(s)`;
}

const validState = (s) =>
  s &&
  typeof s === "object" &&
  s.version === STATE_VERSION &&
  s.hosts &&
  typeof s.hosts === "object" &&
  !Array.isArray(s.hosts) &&
  Array.isArray(s.pairs) &&
  Array.isArray(s.strong);

/**
 * Pure: the notification lines for index relative to state, and the state to save once they have
 * been delivered. A missing (or unusable) state seeds from the index and reports only the summary
 * and an initialisation line.
 */
export function diffIndex(index, state) {
  const contacts = contactsOf(index);
  const summary = summaryLine(index, contacts);
  const current = stateOf(index, contacts);
  if (!validState(state)) return { messages: [summary, INIT_LINE], nextState: current };

  const knownHosts = new Set(Object.keys(state.hosts));
  const knownPairs = new Set(state.pairs);
  const knownStrong = new Set(state.strong);
  const messages = [];

  const where = (c) => `${clean(c.rig)}, ${clean(c.variant)}`;
  for (const h of arr(index.hosts)) {
    if (!h || typeof h.host !== "string" || knownHosts.has(h.host)) continue;
    const c = contacts.find((x) => arr(x.hostnames).includes(h.host));
    const site = c ? c.site : arr(h.sites)[0];
    const rig = c ? where(c) : `${clean(arr(h.rigs)[0])}, ${clean(arr(h.variants)[0])}`;
    messages.push(
      `New documented host: ${clean(h.host)}, first seen ${clean(h.first)} on ${clean(site)} (${rig})`,
    );
  }

  const seenPairs = new Set();
  for (const c of contacts)
    for (const h of arr(c.hostnames)) {
      const pair = `${h}|${c.site}`;
      if (!knownHosts.has(h) || knownPairs.has(pair) || seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      messages.push(
        `New site carrying ${clean(h)}: ${clean(c.site)} (${where(c)}, ${clean(c.date)})`,
      );
    }

  const seenStrong = new Set();
  for (const c of contacts) {
    if (!strong(c)) continue;
    const key = strongKey(c);
    if (knownStrong.has(key) || seenStrong.has(key)) continue;
    seenStrong.add(key);
    messages.push(
      `Elevated or above: ${clean(c.ruleId)} [${clean(c.severity)}] on ${clean(c.site)} (${where(c)}, ${clean(c.date)})`,
    );
  }

  // Outcome-based messages need the state fields they compare against; a state saved before
  // they existed is extended without reporting what is already there.
  const hasReplies = state.replies && typeof state.replies === "object";
  const hasAttention = Array.isArray(state.attention);

  if (hasAttention) {
    const known = new Set(state.attention);
    const title = Object.fromEntries(STAGES.map((st) => [st.key, st.title.toLowerCase()]));
    for (const f of attentionFlows(index)) {
      if (known.has(attentionKey(f))) continue;
      known.add(attentionKey(f));
      const dates = arr(f.dates);
      messages.push(
        `Worth a closer look: ${clean(f.host)} on ${clean(f.site)} (${clean(title[f.stage] ?? f.stage)}): ${clean(f.outcome)} (${clean(arr(f.rigs).join(", "))}, ${clean(arr(f.variants).join(", "))}, ${clean(dates[dates.length - 1])})`,
      );
    }
  }

  if (hasReplies)
    for (const [host, r] of repliesOf(index)) {
      const before = state.replies[host];
      if (!before || before === r.reply) continue;
      const o = r.row;
      const at = `on ${clean(o.site)} (${clean(o.rig)}, ${clean(o.variant)}, ${clean(o.date)})`;
      messages.push(
        r.reply === "answers"
          ? `${clean(host)} answers again: ${clean(outcomeLabel(r.cls, o))} ${at}; before, its requests did not complete`
          : `${clean(host)} no longer answers: ${clean(outcomeLabel(r.cls, o))} ${at}; before, it answered`,
      );
    }

  messages.push(summary);

  // Nothing is forgotten: a host or pair that drops out of a later index stays known.
  const hosts = { ...current.hosts, ...state.hosts };
  const next = {
    version: STATE_VERSION,
    hosts: Object.fromEntries(
      Object.keys(hosts)
        .sort()
        .map((k) => [k, hosts[k]]),
    ),
    pairs: uniqSorted([...state.pairs, ...current.pairs]),
    strong: uniqSorted([...state.strong, ...current.strong]),
    // The newest known reply per host; a host missing from this index keeps its last one.
    replies: Object.fromEntries(
      Object.entries({ ...(hasReplies ? state.replies : {}), ...current.replies }).sort(
        ([a], [b]) => (a < b ? -1 : 1),
      ),
    ),
    attention: uniqSorted([...(hasAttention ? state.attention : []), ...current.attention]),
    lastDate: current.lastDate ?? state.lastDate ?? null,
  };
  return { messages, nextState: next };
}

/** Whole-file save: temp file in the same directory, then rename. */
function saveWhole(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function parseArgs(argv) {
  const val = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return {
    index: val("index"),
    state: val("state"),
    always: argv.includes("--always"),
    dryRun: argv.includes("--dry-run"),
  };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return e?.code === "ENOENT" ? null : undefined;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.index || !args.state) {
    console.error(
      "usage: observatory-notify.mjs --index=<index.json> --state=<file> [--always] [--dry-run]",
    );
    process.exit(2);
  }
  const index = readJson(args.index);
  if (!index || typeof index !== "object" || !Array.isArray(index.runs)) {
    console.error(`observatory-notify: cannot read an index from ${args.index}`);
    process.exit(2);
  }
  const statePath = resolve(args.state);
  const { messages, nextState } = diffIndex(index, readJson(statePath) ?? null);
  const text = `${messages.join("\n")}\n`;
  const notable = messages.length > 1;

  if (args.dryRun) {
    process.stdout.write(text);
    console.log(
      `(dry run: ${notable || args.always ? "would deliver" : "nothing to deliver"}; nothing written)`,
    );
    return;
  }

  let delivered = true;
  if (notable || args.always) {
    const cmd = process.env.ADTRIPWIRE_NOTIFY_CMD;
    if (cmd) {
      const r = spawnSync("sh", ["-c", cmd], {
        input: text,
        stdio: ["pipe", "inherit", "inherit"],
        timeout: 60000,
      });
      delivered = r.status === 0;
      if (!delivered)
        console.error(
          `observatory-notify: delivery command failed (${r.error?.message ?? `status ${r.status}`}); state kept for a retry`,
        );
    }
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      const stamp = new Date().toISOString();
      const tag = delivered ? "" : " (delivery failed)";
      appendFileSync(join(dirname(statePath), "notifications.log"), `[${stamp}]${tag}\n${text}\n`);
    } catch (e) {
      console.error(`observatory-notify: cannot write the log: ${e.message}`);
    }
  }
  process.stdout.write(text);
  if (delivered) {
    try {
      saveWhole(statePath, `${JSON.stringify(nextState, null, 2)}\n`);
    } catch (e) {
      console.error(`observatory-notify: cannot write the state: ${e.message}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
