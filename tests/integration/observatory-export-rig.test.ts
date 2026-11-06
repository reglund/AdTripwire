/**
 * scripts/observatory-export-rig.mjs: slug-named, scrubbed per-rig export for rigs/<rig>/.
 * Runs against synthetic run JSON in temp directories.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportRig } from "../../scripts/observatory-export-rig.mjs";

const SCRIPT = resolve(__dirname, "../../scripts/observatory-export-rig.mjs");
const IDENTITY = { home: "/home/rigowner", user: "rigowner" };

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "adtripwire-export-rig-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const runJson = (extra: Record<string, unknown> = {}) => ({
  date: "2026-11-05",
  browser: "chromium",
  device: "Pixel 5",
  sites: "tests/fixtures/exposure-sites.txt",
  etpOff: false,
  seconds: 60,
  totals: {},
  results: [{ site: "https://example.test/", loaded: true, detections: [] }],
  ...extra,
});

/** A cache with one run named like the daily script names it (not like the slug). */
const cache = (run: Record<string, unknown> = runJson(), withExtras = true) => {
  const dir = tmp();
  const stem = "2026-11-05-chromium-pixel-5";
  writeFileSync(join(dir, `${stem}.json`), JSON.stringify(run));
  if (withExtras) {
    writeFileSync(
      join(dir, `${stem}.evidence.json`),
      JSON.stringify({ note: "profile /home/rigowner/snap/chromium/common/p" }),
    );
    mkdirSync(join(dir, "reports"));
    writeFileSync(join(dir, "reports", `${stem}.md`), "Profile at /home/rigowner/snap/x\n");
  }
  return dir;
};
const exp = (dir: string, out: string, extra: Record<string, unknown> = {}) =>
  exportRig({ dir, out, rig: "rig-2", identity: IDENTITY, ...extra });
const read = (out: string, rel: string) => readFileSync(join(out, rel), "utf8");

describe("observatory-export-rig", () => {
  it("writes slug-named files, not cache file names", () => {
    const out = join(tmp(), "export");
    const r = exp(cache(runJson({ device: null, etpOff: false, browser: "firefox" })), out);
    expect(r.runs).toBe(1);
    expect(readdirSync(join(out, "runs")).sort()).toEqual([
      "2026-11-05-firefox.evidence.json",
      "2026-11-05-firefox.json",
    ]);
    expect(readdirSync(join(out, "reports"))).toEqual(["2026-11-05-firefox.md"]);
  });

  it("adds rig when missing and keeps an existing one", () => {
    const a = join(tmp(), "a");
    exp(cache(), a);
    expect(JSON.parse(read(a, "runs/2026-11-05-chromium-pixel-5.json")).rig).toBe("rig-2");
    const b = join(tmp(), "b");
    exp(cache(runJson({ rig: "rig-9" })), b);
    expect(JSON.parse(read(b, "runs/2026-11-05-chromium-pixel-5.json")).rig).toBe("rig-9");
  });

  it("scrubs the home directory in the run, the report and the evidence", () => {
    const out = join(tmp(), "export");
    exp(cache(runJson({ note: "/home/rigowner/list.txt" })), out);
    const all = [
      read(out, "runs/2026-11-05-chromium-pixel-5.json"),
      read(out, "runs/2026-11-05-chromium-pixel-5.evidence.json"),
      read(out, "reports/2026-11-05-chromium-pixel-5.md"),
    ].join("\n");
    expect(all).not.toContain("/home/rigowner");
    expect(read(out, "reports/2026-11-05-chromium-pixel-5.md")).toContain("~/snap/x");
  });

  it("copies evidence only when present and writes rig.json with the run count", () => {
    const out = join(tmp(), "export");
    exp(cache(runJson(), false), out, { country: "NO", network: "home", exportedAt: "T" });
    expect(readdirSync(join(out, "runs"))).toEqual(["2026-11-05-chromium-pixel-5.json"]);
    expect(existsSync(join(out, "reports"))).toBe(false);
    expect(JSON.parse(read(out, "rig.json"))).toEqual({
      rig: "rig-2",
      country: "NO",
      network: "home",
      exportedAt: "T",
      runs: 1,
    });
    const bare = join(tmp(), "bare");
    exp(cache(), bare);
    const j = JSON.parse(read(bare, "rig.json"));
    expect(j).not.toHaveProperty("country");
    expect(j).not.toHaveProperty("network");
  });

  it("empties the out directory of an earlier export first", () => {
    const out = tmp();
    writeFileSync(join(out, "rig.json"), "{}");
    writeFileSync(join(out, "stale.txt"), "x");
    exp(cache(), out);
    expect(existsSync(join(out, "stale.txt"))).toBe(false);
  });

  it("accepts an empty or missing out directory and refuses a non-empty one without rig.json", () => {
    exp(cache(), tmp());
    exp(cache(), join(tmp(), "new", "deeper"));
    const other = tmp();
    mkdirSync(join(other, "docs"));
    writeFileSync(join(other, "docs", "keep.txt"), "x");
    writeFileSync(join(other, "notes.txt"), "x");
    expect(() => exp(cache(), other)).toThrow(/not empty and has no rig\.json/);
    expect(readFileSync(join(other, "docs", "keep.txt"), "utf8")).toBe("x");
    expect(existsSync(join(other, "notes.txt"))).toBe(true);
    const r = spawnSync("node", [SCRIPT, `--dir=${cache()}`, `--out=${other}`, "--rig=oslo"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(existsSync(join(other, "notes.txt"))).toBe(true);
  });

  it("refuses an out directory that contains .git", () => {
    const out = tmp();
    mkdirSync(join(out, ".git"));
    writeFileSync(join(out, "keep.txt"), "x");
    expect(() => exp(cache(), out)).toThrow(/\.git/);
    expect(existsSync(join(out, "keep.txt"))).toBe(true);
  });

  it("rejects an invalid rig name on the command line", () => {
    const r = spawnSync(
      "node",
      [SCRIPT, `--dir=${cache()}`, `--out=${join(tmp(), "o")}`, "--rig=Bad Name"],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--rig/);
  });
});
