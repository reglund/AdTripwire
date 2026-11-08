/**
 * scripts/observatory-notify.mjs: the pure diff against a saved state, and the CLI's dry run.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without declarations
import { diffIndex } from "../../scripts/observatory-notify.mjs";

const SCRIPT = resolve(__dirname, "../../scripts/observatory-notify.mjs");

interface Contact {
  date: string;
  rig: string;
  variant: string;
  slug: string;
  site: string;
  ruleId: string;
  severity: string;
  hostnames: string[];
}

const contact = (over: Partial<Contact> = {}): Contact => ({
  date: "2026-11-05",
  rig: "rig-1",
  variant: "Firefox",
  slug: "firefox",
  site: "news.example.test",
  ruleId: "known_infra.ad_platform",
  severity: "suspicious",
  hostnames: ["ads.example.test"],
  ...over,
});

function indexOf(contacts: Contact[], extraRuns: { date: string; rig: string }[] = []) {
  const hosts = new Map<string, { first: string; last: string; sites: Set<string> }>();
  for (const c of contacts)
    for (const h of c.hostnames) {
      const e = hosts.get(h) ?? { first: c.date, last: c.date, sites: new Set<string>() };
      e.first = c.date < e.first ? c.date : e.first;
      e.sites.add(c.site);
      hosts.set(h, e);
    }
  const runs = [
    { date: "2026-11-04", rig: "rig-1", variant: "Firefox" },
    { date: "2026-11-05", rig: "rig-1", variant: "Firefox" },
    ...extraRuns,
  ];
  return {
    schemaVersion: 1,
    runs,
    contacts,
    hosts: [...hosts].map(([host, e]) => ({
      host,
      first: e.first,
      last: e.last,
      days: [e.first],
      variants: ["Firefox"],
      sites: [...e.sites],
      rigs: ["rig-1"],
    })),
    rigs: [{ rig: "rig-1" }],
  };
}

const base = indexOf([contact({ date: "2026-11-04" }), contact()]);

describe("diffIndex", () => {
  it("seeds on the first run and reports only the summary and the initialisation line", () => {
    const { messages, nextState } = diffIndex(base, null);
    expect(messages).toEqual([
      "Observatory 2026-11-05: 1 run(s), 1 contact(s), 1 documented host(s), 1 rig(s)",
      "Notification state initialised; future runs report changes only.",
    ]);
    expect(nextState.version).toBe(1);
    expect(nextState.hosts).toEqual({ "ads.example.test": "2026-11-04" });
    expect(nextState.pairs).toEqual(["ads.example.test|news.example.test"]);
    expect(nextState.lastDate).toBe("2026-11-05");
  });

  it("reports a new documented host", () => {
    const { nextState: state } = diffIndex(base, null);
    const next = indexOf([
      contact({ date: "2026-11-04" }),
      contact(),
      contact({ hostnames: ["new.example.test"], site: "other.example.test", variant: "Chromium" }),
    ]);
    const { messages, nextState } = diffIndex(next, state);
    expect(messages[0]).toBe(
      "New documented host: new.example.test, first seen 2026-11-05 on other.example.test (rig-1, Chromium)",
    );
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatch(/^Observatory 2026-11-05: /);
    expect(nextState.hosts["new.example.test"]).toBe("2026-11-05");
  });

  it("reports a new site for a known host", () => {
    const { nextState: state } = diffIndex(base, null);
    const next = indexOf([
      contact({ date: "2026-11-04" }),
      contact(),
      contact({ site: "paper.example.test" }),
    ]);
    const { messages, nextState } = diffIndex(next, state);
    expect(messages[0]).toBe(
      "New site carrying ads.example.test: paper.example.test (rig-1, Firefox, 2026-11-05)",
    );
    expect(messages).toHaveLength(2);
    expect(nextState.pairs).toContain("ads.example.test|paper.example.test");
  });

  it("reports a new elevated detection and a correlation, once", () => {
    const { nextState: state } = diffIndex(base, null);
    const next = indexOf([
      contact({ date: "2026-11-04" }),
      contact(),
      contact({ ruleId: "page.suspicious_script", severity: "elevated", hostnames: [] }),
      contact({ ruleId: "correlation.chain", severity: "suspicious", hostnames: [] }),
    ]);
    const { messages, nextState } = diffIndex(next, state);
    expect(messages.slice(0, 2)).toEqual([
      "Elevated or above: page.suspicious_script [elevated] on news.example.test (rig-1, Firefox, 2026-11-05)",
      "Elevated or above: correlation.chain [suspicious] on news.example.test (rig-1, Firefox, 2026-11-05)",
    ]);
    expect(messages).toHaveLength(3);
    expect(diffIndex(next, nextState).messages).toHaveLength(1);
  });

  it("reports only the summary for an unchanged index and keeps the state", () => {
    const { nextState: state } = diffIndex(base, null);
    const { messages, nextState } = diffIndex(base, state);
    expect(messages).toEqual([
      "Observatory 2026-11-05: 1 run(s), 1 contact(s), 1 documented host(s), 1 rig(s)",
    ]);
    expect(nextState).toEqual(state);
  });

  it("never uses a verdict word", () => {
    const next = indexOf([contact({ ruleId: "correlation.chain", hostnames: ["x.example.test"] })]);
    const text = diffIndex(next, diffIndex(base, null).nextState).messages.join("\n");
    expect(text).not.toMatch(/\b(safe|clean|infected|spied)\b/i);
  });
});

describe("diffIndex: request outcomes and closer-look flows", () => {
  const H = "events.example.test";
  const outcome = (date: string, over: Record<string, unknown> = {}) => ({
    date,
    rig: "rig-1",
    variant: "Chromium / Pixel 5",
    site: "news.example.test",
    host: H,
    indicator: "adf-test",
    requests: 1,
    statuses: {},
    failures: { "net::ERR_NAME_NOT_RESOLVED": 1 },
    ...over,
  });
  const answered = { statuses: { "200": 1 }, failures: {}, maxBytes: 512 };
  const withOutcomes = (outcomes: unknown[], flows: unknown[] = []) => ({
    ...base,
    outcomes,
    flows,
  });
  const flow = (over: Record<string, unknown> = {}) => ({
    site: "news.example.test",
    host: H,
    stage: "delivery",
    outcomeClass: "content",
    outcome: "Answered with content (up to 512 bytes declared)",
    reading: { text: "…", attention: true },
    dates: ["2026-11-05"],
    rigs: ["rig-1"],
    variants: ["Chromium / Pixel 5"],
    ...over,
  });

  it("reports a host whose requests get an answer again, once", () => {
    const { nextState: state } = diffIndex(withOutcomes([outcome("2026-11-04")]), null);
    expect(state.replies).toEqual({ [H]: "silent" });
    const next = withOutcomes([outcome("2026-11-04"), outcome("2026-11-05", answered)]);
    const { messages, nextState } = diffIndex(next, state);
    expect(messages[0]).toBe(
      `${H} answers again: Answered with content (up to 512 bytes declared) on news.example.test (rig-1, Chromium / Pixel 5, 2026-11-05); before, its requests did not complete`,
    );
    expect(messages).toHaveLength(2);
    expect(diffIndex(next, nextState).messages).toHaveLength(1);
  });

  it("reports a host that stops answering", () => {
    const { nextState: state } = diffIndex(withOutcomes([outcome("2026-11-04", answered)]), null);
    const next = withOutcomes([outcome("2026-11-04", answered), outcome("2026-11-05")]);
    const { messages } = diffIndex(next, state);
    expect(messages[0]).toMatch(
      new RegExp(`^${H} no longer answers: Did not complete: the name no longer resolves`),
    );
  });

  it("counts a day as answered when any request that day was answered", () => {
    const { nextState: state } = diffIndex(withOutcomes([outcome("2026-11-04")]), null);
    const next = withOutcomes([
      outcome("2026-11-05", { site: "a.example.test" }),
      outcome("2026-11-05", { site: "b.example.test", ...answered }),
    ]);
    const { messages } = diffIndex(next, state);
    expect(messages[0]).toMatch(/answers again: .* on b\.example\.test/);
  });

  it("does not treat a request without a recorded end as a change", () => {
    const { nextState: state } = diffIndex(withOutcomes([outcome("2026-11-04", answered)]), null);
    const next = withOutcomes([
      outcome("2026-11-04", answered),
      outcome("2026-11-05", { failures: {}, statuses: {} }),
    ]);
    expect(diffIndex(next, state).messages).toHaveLength(1);
  });

  it("reports a new closer-look flow once, and ignores flows without the mark", () => {
    const { nextState: state } = diffIndex(withOutcomes([]), null);
    const next = withOutcomes(
      [],
      [flow(), flow({ site: "x.example.test", reading: { text: "…", attention: false } })],
    );
    const { messages, nextState } = diffIndex(next, state);
    expect(messages[0]).toBe(
      `Worth a closer look: ${H} on news.example.test (delivery and staging): Answered with content (up to 512 bytes declared) (rig-1, Chromium / Pixel 5, 2026-11-05)`,
    );
    expect(messages).toHaveLength(2);
    expect(diffIndex(next, nextState).messages).toHaveLength(1);
  });

  it("extends a state saved before outcomes were tracked without reporting what is there", () => {
    const { nextState: full } = diffIndex(base, null);
    const { replies: _r, attention: _a, ...old } = full;
    const next = withOutcomes([outcome("2026-11-05", answered)], [flow()]);
    const { messages, nextState } = diffIndex(next, old);
    expect(messages).toHaveLength(1);
    expect(nextState.replies).toEqual({ [H]: "answers" });
    expect(nextState.attention).toEqual([`${H}|news.example.test|content`]);
  });
});

describe("observatory-notify CLI", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  it("--dry-run prints the text and writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "adtripwire-notify-"));
    dirs.push(dir);
    const index = join(dir, "index.json");
    const state = join(dir, "state", "notify-state.json");
    writeFileSync(index, JSON.stringify(base));
    const out = execFileSync(
      "node",
      [SCRIPT, `--index=${index}`, `--state=${state}`, "--dry-run"],
      { encoding: "utf8", env: { ...process.env, ADTRIPWIRE_NOTIFY_CMD: "exit 1" } },
    );
    expect(out).toContain("Observatory 2026-11-05: 1 run(s)");
    expect(out).toContain("Notification state initialised");
    expect(existsSync(join(dir, "state"))).toBe(false);
    expect(readdirSync(dir)).toEqual(["index.json"]);
  });

  it("delivers on stdin, logs, and saves the state only after a successful delivery", () => {
    const dir = mkdtempSync(join(tmpdir(), "adtripwire-notify-"));
    dirs.push(dir);
    const index = join(dir, "index.json");
    const state = join(dir, "notify-state.json");
    writeFileSync(index, JSON.stringify(base));
    const run = (cmd: string) =>
      execFileSync("node", [SCRIPT, `--index=${index}`, `--state=${state}`], {
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, ADTRIPWIRE_NOTIFY_CMD: cmd },
      });
    run(`cat > '${join(dir, "got.txt")}'; exit 1`);
    expect(existsSync(state)).toBe(false);
    expect(readFileSync(join(dir, "got.txt"), "utf8")).toContain("Notification state initialised");
    run(`cat > '${join(dir, "got.txt")}'`);
    expect(existsSync(state)).toBe(true);
    expect(readFileSync(join(dir, "notifications.log"), "utf8")).toContain("(delivery failed)");
    // Nothing new: no delivery (the command would overwrite the file with the summary alone).
    writeFileSync(join(dir, "got.txt"), "untouched");
    run(`cat > '${join(dir, "got.txt")}'`);
    expect(readFileSync(join(dir, "got.txt"), "utf8")).toBe("untouched");
  });

  it("exits 2 on an unreadable index", () => {
    const dir = mkdtempSync(join(tmpdir(), "adtripwire-notify-"));
    dirs.push(dir);
    let status = 0;
    try {
      execFileSync(
        "node",
        [SCRIPT, `--index=${join(dir, "nope.json")}`, `--state=${join(dir, "s")}`],
        {
          stdio: "pipe",
        },
      );
    } catch (e) {
      status = (e as { status: number }).status;
    }
    expect(status).toBe(2);
  });
});
