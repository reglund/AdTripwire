/**
 * scripts/observatory-publish.sh end to end against local bare repositories: commit identity,
 * UTC timestamps, refusal to overwrite a code branch, and remote validation.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../scripts/observatory-publish.sh");
const SYNC = resolve(__dirname, "../../scripts/observatory-sync.sh");
const CHECKOUT = resolve(__dirname, "../..");
const IDENTITY = "AdTripwire observatory <observatory@adtripwire.invalid>";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "adtripwire-publish-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

// A global identity and a non-UTC zone: neither may leak into the published commits.
const root = tmp();
const gitconfig = join(root, "gitconfig");
writeFileSync(gitconfig, "[user]\n\tname = Someone Else\n\temail = someone@example.org\n");
const env = (extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH as string,
  HOME: root,
  GIT_CONFIG_GLOBAL: gitconfig,
  GIT_CONFIG_NOSYSTEM: "1",
  TZ: "Pacific/Auckland",
  ...extra,
});

const run = (cmd: string, args: string[], e: Record<string, string>, cwd?: string) => {
  const r = spawnSync(cmd, args, { env: e, cwd, encoding: "utf8" });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const git = (cwd: string, ...args: string[]) => run("git", args, env(), cwd);

const bare = () => {
  const d = join(tmp(), "remote.git");
  expect(git(tmpdir(), "init", "-q", "--bare", d).status).toBe(0);
  return d;
};
const site = (marker = "one") => {
  const d = join(tmp(), "site");
  mkdirSync(join(d, "data"), { recursive: true });
  writeFileSync(join(d, "index.html"), `<!doctype html><p>${marker}</p>\n`);
  writeFileSync(join(d, "data", "index.json"), "{}\n");
  return d;
};
const publish = (remote: string, dir: string, extra: Record<string, string> = {}) =>
  run("sh", [SCRIPT, dir], env({ ADTRIPWIRE_OBSERVATORY_REMOTE: remote, ...extra }));

const exportDir = (marker = "one", extra: string[] = []) => {
  const d = join(tmp(), "export");
  mkdirSync(join(d, "runs"), { recursive: true });
  mkdirSync(join(d, "reports"), { recursive: true });
  writeFileSync(join(d, "rig.json"), `{"rig":"x","marker":"${marker}"}\n`);
  writeFileSync(join(d, "runs", "2026-11-06-a.json"), `{"marker":"${marker}"}\n`);
  writeFileSync(join(d, "reports", "2026-11-06-a.md"), `# ${marker}\n`);
  for (const f of extra) writeFileSync(join(d, f), "x\n");
  return d;
};
const publishRig = (
  remote: string,
  name: string,
  dir: string,
  extra: Record<string, string> = {},
) =>
  run("sh", [SCRIPT, "--rig", name, dir], env({ ADTRIPWIRE_OBSERVATORY_REMOTE: remote, ...extra }));
const sync = (remote: string | null, dir: string, extra: Record<string, string> = {}) =>
  run(
    "sh",
    [SYNC, dir],
    env({ ...(remote === null ? {} : { ADTRIPWIRE_OBSERVATORY_REMOTE: remote }), ...extra }),
  );
const files = (remote: string, branch = "observatory") =>
  git(remote, "ls-tree", "-r", "--name-only", branch).out.split("\n").filter(Boolean);
/** Pushes a commit with the given files to a branch of the bare repository, as someone else. */
const seed = (remote: string, branch: string, tree: Record<string, string>) => {
  const dir = join(tmp(), "seed");
  expect(git(tmpdir(), "init", "-q", "-b", branch, dir).status).toBe(0);
  for (const [f, body] of Object.entries(tree)) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  git(dir, "add", "-A");
  const c = git(
    dir,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t.invalid",
    "commit",
    "-q",
    "-m",
    "s",
  );
  expect(c.status, c.err).toBe(0);
  expect(git(dir, "push", "-q", remote, `HEAD:refs/heads/${branch}`).status).toBe(0);
};
const rejectingHook = (remote: string, counter: string | null) => {
  const hook = join(remote, "hooks", "pre-receive");
  const body =
    counter === null
      ? "exit 1\n"
      : `if [ ! -e "${counter}" ]; then : > "${counter}"; exit 1; fi\nexit 0\n`;
  writeFileSync(hook, `#!/bin/sh\n${body}`);
  chmodSync(hook, 0o755);
};

describe("observatory-publish.sh", () => {
  it("commits as the observatory identity with a UTC timestamp, whatever the global config says", () => {
    const remote = bare();
    const r = publish(remote, site());
    expect(r.status, r.err).toBe(0);
    const log = git(remote, "log", "observatory", "--format=%an <%ae> %ad", "--date=iso-strict");
    expect(log.out.trim()).toMatch(
      new RegExp(
        `^${IDENTITY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d{4}-\\d{2}-\\d{2}T[\\d:]+(?:\\+00:00|Z)$`,
      ),
    );
    const committer = git(
      remote,
      "log",
      "observatory",
      "--format=%cn <%ce> %cd",
      "--date=iso-strict",
    );
    expect(committer.out.trim()).toContain(IDENTITY);
    expect(committer.out.trim()).toMatch(/(?:\+00:00|Z)$/);
    const files = git(remote, "ls-tree", "-r", "--name-only", "observatory").out.split("\n");
    expect(files).toEqual(expect.arrayContaining([".nojekyll", "index.html", "data/index.json"]));
  });

  it("makes no commit when nothing changed and replaces content when it did", () => {
    const remote = bare();
    expect(publish(remote, site("one")).status).toBe(0);
    const again = publish(remote, site("one"));
    expect(again.out).toContain("no changes");
    expect(git(remote, "rev-list", "--count", "observatory").out.trim()).toBe("1");
    expect(publish(remote, site("two")).status).toBe(0);
    expect(git(remote, "rev-list", "--count", "observatory").out.trim()).toBe("2");
  });

  it("refuses an existing branch that is not a published site, and leaves it untouched", () => {
    const remote = bare();
    const seed = join(tmp(), "seed");
    expect(git(tmpdir(), "init", "-q", "-b", "main", seed).status).toBe(0);
    writeFileSync(join(seed, "README.md"), "code\n");
    writeFileSync(join(seed, "package.json"), "{}\n");
    git(seed, "add", "-A");
    expect(
      git(seed, "-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "-m", "code")
        .status,
    ).toBe(0);
    expect(git(seed, "push", "-q", remote, "main").status).toBe(0);
    const before = git(remote, "rev-parse", "main").out;

    const r = publish(remote, site(), { ADTRIPWIRE_OBSERVATORY_BRANCH: "main" });
    expect(r.status).toBe(2);
    expect(r.err).toContain("refusing to overwrite");
    expect(git(remote, "rev-parse", "main").out).toBe(before);
  });

  it("publishes to main of a dedicated repository, and again once main holds a site", () => {
    const remote = bare();
    const opts = { ADTRIPWIRE_OBSERVATORY_BRANCH: "main" };
    expect(publish(remote, site("one"), opts).status).toBe(0);
    const r = publish(remote, site("two"), opts);
    expect(r.status, r.err).toBe(0);
    expect(git(remote, "rev-list", "--count", "main").out.trim()).toBe("2");
  });

  it("refuses a relative path or a bare word as the remote without printing it", () => {
    for (const remote of ["relative/remote.git", "secret-token-remote", "-oops"]) {
      const r = publish(remote, site());
      expect(r.status, remote).toBe(2);
      expect(r.out + r.err).not.toContain(remote);
    }
  });

  it("reports an unreachable remote without naming it", () => {
    const remote = join(tmp(), "does-not-exist.git");
    const r = publish(remote, site());
    expect(r.status).toBe(1);
    expect(r.err).toContain("cannot reach the configured remote");
    expect(r.out).not.toContain(remote);
  });

  it("does nothing when publishing is not configured", () => {
    const r = run("sh", [SCRIPT, site()], env());
    expect(r.status).toBe(0);
    expect(r.out).toContain("not configured");
  });
});

describe("observatory-publish.sh --rig", () => {
  it("creates rigs/<name>/ with the commit message and leaves every other path alone", () => {
    const remote = bare();
    expect(publish(remote, site("one")).status).toBe(0);
    const before = git(remote, "rev-parse", "observatory:index.html", "observatory:data").out;
    const r = publishRig(remote, "rig-1", exportDir("one"));
    expect(r.status, r.err).toBe(0);
    expect(files(remote)).toEqual(
      expect.arrayContaining([
        ".nojekyll",
        "index.html",
        "data/index.json",
        "rigs/rig-1/rig.json",
        "rigs/rig-1/runs/2026-11-06-a.json",
        "rigs/rig-1/reports/2026-11-06-a.md",
      ]),
    );
    expect(git(remote, "rev-parse", "observatory:index.html", "observatory:data").out).toBe(before);
    const log = git(remote, "log", "-1", "observatory", "--format=%an <%ae>|%s");
    expect(log.out.trim()).toMatch(
      new RegExp(
        `^${IDENTITY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\|observatory rig rig-1 \\d{4}-\\d{2}-\\d{2}$`,
      ),
    );
  });

  it("replaces the rig directory only: removed files go, a no-op says so", () => {
    const remote = bare();
    expect(publishRig(remote, "rig-1", exportDir("one", ["old.txt"])).status).toBe(0);
    expect(files(remote)).toContain("rigs/rig-1/old.txt");
    const again = publishRig(remote, "rig-1", exportDir("one", ["old.txt"]));
    expect(again.out).toContain("no changes");
    expect(publishRig(remote, "rig-1", exportDir("two")).status).toBe(0);
    expect(files(remote)).not.toContain("rigs/rig-1/old.txt");
    expect(git(remote, "rev-list", "--count", "observatory").out.trim()).toBe("2");
  });

  it("publishes two rigs in turn without the second commit touching the first rig", () => {
    const remote = bare();
    expect(publishRig(remote, "rig-1", exportDir("one")).status).toBe(0);
    const r = publishRig(remote, "oslo", exportDir("two"));
    expect(r.status, r.err).toBe(0);
    const all = files(remote);
    expect(all).toEqual(
      expect.arrayContaining([
        "rigs/rig-1/rig.json",
        "rigs/oslo/rig.json",
        "rigs/oslo/runs/2026-11-06-a.json",
      ]),
    );
    const touched = git(remote, "diff-tree", "--no-commit-id", "--name-only", "-r", "observatory")
      .out.split("\n")
      .filter(Boolean);
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.every((f) => f.startsWith("rigs/oslo/"))).toBe(true);
    expect(git(remote, "rev-list", "--count", "observatory").out.trim()).toBe("2");
  });

  it("lets root mode publish after rigs did, keeping rigs/ and replacing the rest", () => {
    const remote = bare();
    expect(publishRig(remote, "rig-1", exportDir("one")).status).toBe(0);
    expect(publishRig(remote, "oslo", exportDir("two")).status).toBe(0);
    const first = publish(remote, site("one"));
    expect(first.status, first.err).toBe(0);
    expect(files(remote)).toEqual(
      expect.arrayContaining([
        "index.html",
        "data/index.json",
        "rigs/rig-1/rig.json",
        "rigs/oslo/rig.json",
      ]),
    );
    const next = site("two");
    rmSync(join(next, "data", "index.json"));
    writeFileSync(join(next, "data", "other.json"), "{}\n");
    mkdirSync(join(next, "rigs"));
    writeFileSync(join(next, "rigs", "evil.txt"), "x\n");
    expect(publish(remote, next).status).toBe(0);
    const all = files(remote);
    expect(all).toEqual(
      expect.arrayContaining([
        "index.html",
        "data/other.json",
        "rigs/rig-1/rig.json",
        "rigs/oslo/rig.json",
      ]),
    );
    expect(all).not.toContain("data/index.json");
    expect(all).not.toContain("rigs/evil.txt");
  });

  it("refuses root mode on a branch with other content at its root, and leaves it untouched", () => {
    const remote = bare();
    seed(remote, "observatory", { "index.html": "x\n", "src/app.js": "x\n" });
    const before = git(remote, "rev-parse", "observatory").out;
    const r = publish(remote, site());
    expect(r.status).toBe(2);
    expect(r.err).toContain("refusing to overwrite");
    expect(r.err).toContain("src");
    expect(git(remote, "rev-parse", "observatory").out).toBe(before);
    const rig = publishRig(remote, "rig-1", exportDir());
    expect(rig.status).toBe(2);
    expect(git(remote, "rev-parse", "observatory").out).toBe(before);
  });

  it("validates the rig name and the export directory", () => {
    const remote = bare();
    for (const name of ["Bad", "-x", "has_underscore", "a".repeat(33), "../x", ""]) {
      const r = publishRig(remote, name, exportDir());
      expect(r.status, name).toBe(2);
    }
    const noJson = join(tmp(), "export");
    mkdirSync(noJson);
    expect(publishRig(remote, "rig-1", noJson).status).toBe(2);
    expect(
      run("sh", [SCRIPT, "--rig", "rig-1"], env({ ADTRIPWIRE_OBSERVATORY_REMOTE: remote })).status,
    ).toBe(2);
    expect(git(remote, "branch", "--list").out.trim()).toBe("");
    expect(publishRig(remote, "a".repeat(32), exportDir()).status).toBe(0);
  });

  it("refuses a rig name with a newline or a leading hyphen and leaves the branch untouched", () => {
    const remote = bare();
    expect(publishRig(remote, "rig-1", exportDir("one")).status).toBe(0);
    const before = git(remote, "rev-parse", "observatory").out;
    for (const name of ["a\n..", "a\n", "\nab", "-x", "ab\ncd"]) {
      const r = publishRig(remote, name, exportDir("two"));
      expect(r.status, JSON.stringify(name)).toBe(2);
      expect(r.err).toContain("rig name must match");
    }
    expect(git(remote, "rev-parse", "observatory").out).toBe(before);
    expect(files(remote)).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/^rigs\/(a|-x|ab)/)]),
    );
  });
});

describe("observatory-publish.sh push retries", () => {
  it("retries once after a rejected push and then succeeds", () => {
    const remote = bare();
    const counter = join(tmp(), "rejected-once");
    rejectingHook(remote, counter);
    const r = publish(remote, site());
    expect(r.status, r.err).toBe(0);
    expect(existsSync(counter)).toBe(true);
    expect(r.out).toContain("retrying");
    expect(git(remote, "rev-list", "--count", "observatory").out.trim()).toBe("1");
  });

  it("retries in rig mode too", () => {
    const remote = bare();
    rejectingHook(remote, join(tmp(), "rejected-once"));
    const r = publishRig(remote, "rig-1", exportDir());
    expect(r.status, r.err).toBe(0);
    expect(files(remote)).toContain("rigs/rig-1/rig.json");
  });

  it("gives up with a non-zero exit after three rejected attempts", () => {
    const remote = bare();
    rejectingHook(remote, null);
    const r = publish(remote, site());
    expect(r.status).toBe(1);
    expect(r.out.match(/retrying/g)).toHaveLength(2);
    expect(r.out + r.err).not.toContain(remote);
    expect(git(remote, "branch", "--list").out.trim()).toBe("");
  });
});

describe("observatory-sync.sh", () => {
  it("clones the branch, then fetches and resets after a new commit", () => {
    const remote = bare();
    expect(publishRig(remote, "rig-1", exportDir("one")).status).toBe(0);
    const dir = join(tmp(), "sync");
    const first = sync(remote, dir);
    expect(first.status, first.err).toBe(0);
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(readFileSync(join(dir, "rigs", "rig-1", "rig.json"), "utf8")).toContain('"one"');

    // Local drift is discarded; a new rig and a changed file arrive.
    writeFileSync(join(dir, "rigs", "rig-1", "rig.json"), "drift\n");
    expect(publishRig(remote, "oslo", exportDir("two")).status).toBe(0);
    const second = sync(remote, dir);
    expect(second.status, second.err).toBe(0);
    expect(readFileSync(join(dir, "rigs", "rig-1", "rig.json"), "utf8")).toContain('"one"');
    expect(readdirSync(join(dir, "rigs")).sort()).toEqual(["oslo", "rig-1"]);
    expect(first.out + first.err + second.out + second.err).not.toContain(remote);
  });

  it("never leaves a symbolic link from the branch on disk", () => {
    const remote = bare();
    const dir = join(tmp(), "seed");
    expect(git(tmpdir(), "init", "-q", "-b", "observatory", dir).status).toBe(0);
    mkdirSync(join(dir, "rigs", "evil"), { recursive: true });
    symlinkSync("/etc", join(dir, "rigs", "evil", "runs"));
    writeFileSync(join(dir, "index.html"), "x\n");
    git(dir, "add", "-A");
    const c = git(
      dir,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t.invalid",
      "commit",
      "-q",
      "-m",
      "s",
    );
    expect(c.status, c.err).toBe(0);
    expect(git(dir, "push", "-q", remote, "HEAD:refs/heads/observatory").status).toBe(0);
    const target = join(tmp(), "sync");
    const first = sync(remote, target);
    expect(first.status, first.err).toBe(0);
    expect(lstatSync(join(target, "rigs", "evil", "runs")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(target, "rigs", "evil", "runs"), "utf8")).toBe("/etc");
    // The same on a later fetch, and in a clone made before the setting existed.
    rmSync(join(target, "rigs", "evil", "runs"));
    git(target, "config", "--unset", "core.symlinks");
    const second = sync(remote, target);
    expect(second.status, second.err).toBe(0);
    expect(lstatSync(join(target, "rigs", "evil", "runs")).isSymbolicLink()).toBe(false);
  });

  it("refuses an existing repository that is not an observatory clone and leaves it alone", () => {
    const remote = bare();
    expect(publishRig(remote, "rig-1", exportDir()).status).toBe(0);
    const other = join(tmp(), "code");
    expect(git(tmpdir(), "init", "-q", other).status).toBe(0);
    writeFileSync(join(other, "src.txt"), "mine\n");
    const r = sync(remote, other);
    expect(r.status).toBe(2);
    expect(r.err).toContain("not an observatory clone");
    expect(readFileSync(join(other, "src.txt"), "utf8")).toBe("mine\n");
    expect(existsSync(join(other, "rigs"))).toBe(false);
  });

  it("fetches from the configured remote, whatever origin points at", () => {
    const remote = bare();
    expect(publishRig(remote, "rig-1", exportDir("one")).status).toBe(0);
    const dir = join(tmp(), "sync");
    expect(sync(remote, dir).status).toBe(0);
    git(dir, "remote", "set-url", "origin", join(tmp(), "elsewhere.git"));
    expect(publishRig(remote, "oslo", exportDir("two")).status).toBe(0);
    const again = sync(remote, dir);
    expect(again.status, again.err).toBe(0);
    expect(readdirSync(join(dir, "rigs")).sort()).toEqual(["oslo", "rig-1"]);
  });

  it("creates an empty rigs/ when the branch does not exist yet", () => {
    const remote = bare();
    const dir = join(tmp(), "sync");
    const r = sync(remote, dir);
    expect(r.status, r.err).toBe(0);
    expect(readdirSync(join(dir, "rigs"))).toEqual([]);
    const other = sync(remote, join(tmp(), "sync2"), { ADTRIPWIRE_OBSERVATORY_BRANCH: "nope" });
    expect(other.status).toBe(0);
  });

  it("creates an empty rigs/ and exits 0 when publishing is not configured", () => {
    const dir = join(tmp(), "sync");
    const r = sync(null, dir);
    expect(r.status).toBe(0);
    expect(r.out).toContain("not configured");
    expect(readdirSync(join(dir, "rigs"))).toEqual([]);
  });

  it("exits 1 for an unreachable remote and 2 for a bad one, without naming it", () => {
    const missing = join(tmp(), "does-not-exist.git");
    const r = sync(missing, join(tmp(), "sync"));
    expect(r.status).toBe(1);
    expect(r.out + r.err).not.toContain(missing);
    const bad = sync("secret-token-remote", join(tmp(), "sync"));
    expect(bad.status).toBe(2);
    expect(bad.out + bad.err).not.toContain("secret-token-remote");
  });

  it("refuses a directory inside the AdTripwire checkout and does not create it", () => {
    const remote = bare();
    expect(publishRig(remote, "rig-1", exportDir()).status).toBe(0);
    for (const d of [join(CHECKOUT, "sync-must-not-exist"), CHECKOUT, join(CHECKOUT, "docs")]) {
      const r = sync(remote, d);
      expect(r.status, d).toBe(2);
      expect(r.err).toContain("outside the AdTripwire checkout");
    }
    expect(existsSync(join(CHECKOUT, "sync-must-not-exist"))).toBe(false);
  });
});
