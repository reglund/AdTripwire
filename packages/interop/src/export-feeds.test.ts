import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/export-feeds.mjs", import.meta.url));
const dirs: string[] = [];

function run(): string {
  const dir = mkdtempSync(join(tmpdir(), "adtripwire-feeds-"));
  dirs.push(dir);
  execFileSync(process.execPath, [script, "--out", dir], { stdio: "pipe" });
  return dir;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("scripts/export-feeds.mjs", () => {
  it("writes the three feeds plus README, byte-identical across runs", () => {
    const a = run();
    const b = run();
    const files = readdirSync(a).sort();
    expect(files).toEqual([
      "README.md",
      "adtripwire-indicators.stix.json",
      "adtripwire.suricata.rules",
      "adtripwire.zeek-intel.tsv",
    ]);
    for (const f of files) {
      expect(readFileSync(join(b, f)).equals(readFileSync(join(a, f))), f).toBe(true);
    }
    const stix = JSON.parse(readFileSync(join(a, "adtripwire-indicators.stix.json"), "utf8"));
    expect(stix.type).toBe("bundle");
    const zeek = readFileSync(join(a, "adtripwire.zeek-intel.tsv"), "utf8");
    expect(zeek).not.toMatch(/\.(test|invalid)\t/);
  }, 60_000);
});
