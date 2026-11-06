/**
 * scripts/observatory-publish.sh end to end against local bare repositories: commit identity,
 * UTC timestamps, refusal to overwrite a code branch, and remote validation.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../scripts/observatory-publish.sh");
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

describe("observatory-publish.sh", () => {
  it("commits as the observatory identity with a UTC timestamp, whatever the global config says", () => {
    const remote = bare();
    const r = publish(remote, site());
    expect(r.status, r.err).toBe(0);
    const log = git(remote, "log", "observatory", "--format=%an <%ae> %ad", "--date=iso-strict");
    expect(log.out.trim()).toMatch(
      new RegExp(
        `^${IDENTITY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d{4}-\\d{2}-\\d{2}T[\\d:]+\\+00:00$`,
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
    expect(committer.out.trim()).toMatch(/\+00:00$/);
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
