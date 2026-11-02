#!/usr/bin/env node
/**
 * Reproducible release packaging (Phase 6).
 *
 *   node scripts/release-package.mjs            build both browsers (default + assist), package
 *   node scripts/release-package.mjs --check    additionally rebuild and verify byte-identity
 *
 * Output in dist-release/: adtripwire-<browser>[-assist]-<version>.zip, adtripwire-source-<version>.zip
 * (the committed tree), sbom.cdx.json, SHA256SUMS. All zips use the deterministic writer in zip.mjs
 * (sorted entries, fixed timestamps), so the same commit yields the same bytes on any machine
 * with the same Node and esbuild versions (pinned by the lockfile).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildZip } from "./zip.mjs";
import { buildSbom } from "./sbom.mjs";

const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const out = join(root, "dist-release");
const check = process.argv.includes("--check");

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}
function zipDir(dir) {
  return buildZip(
    walk(dir).map((p) => ({ path: relative(dir, p).split("\\").join("/"), data: readFileSync(p) })),
  );
}
function buildVariant(app, assist) {
  execFileSync(
    "node",
    [join(root, `apps/extension-${app}/build.mjs`), ...(assist ? ["--assist"] : [])],
    {
      stdio: "ignore",
    },
  );
  return zipDir(join(root, `apps/extension-${app}/dist`));
}
const sha = (b) => createHash("sha256").update(b).digest("hex");

function packageAll() {
  const artifacts = new Map();
  for (const app of ["firefox", "chromium"]) {
    for (const assist of [false, true]) {
      const name = `adtripwire-${app}${assist ? "-assist" : ""}-${version}.zip`;
      artifacts.set(name, buildVariant(app, assist));
    }
  }
  // Source archive for store review: exactly the committed tree, written with the same
  // deterministic zip writer (git archive's zip output varies between git/zlib versions).
  if (execFileSync("git", ["status", "--porcelain"], { cwd: root }).toString().trim() !== "")
    throw new Error("working tree is not clean; the source archive must match the commit");
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString()
    .split("\0")
    .filter((f) => f.length > 0);
  artifacts.set(
    `adtripwire-source-${version}.zip`,
    buildZip(
      tracked.map((f) => ({
        path: `adtripwire-${version}/${f}`,
        data: readFileSync(join(root, f)),
      })),
    ),
  );
  artifacts.set("sbom.cdx.json", Buffer.from(JSON.stringify(buildSbom(root), null, 2) + "\n"));
  return artifacts;
}

const first = packageAll();
if (check) {
  const second = packageAll();
  const diffs = [...first].filter(([k, v]) => sha(v) !== sha(second.get(k)));
  if (diffs.length) {
    console.error(`NOT reproducible: ${diffs.map(([k]) => k).join(", ")}`);
    process.exit(1);
  }
  console.log("reproducibility check passed: second build is byte-identical");
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const sums = [];
for (const [name, data] of [...first].sort(([a], [b]) => (a < b ? -1 : 1))) {
  writeFileSync(join(out, name), data);
  sums.push(`${sha(data)}  ${name}`);
}
writeFileSync(join(out, "SHA256SUMS"), sums.join("\n") + "\n");
console.log(sums.join("\n"));
console.log(`release artifacts → ${out}`);
