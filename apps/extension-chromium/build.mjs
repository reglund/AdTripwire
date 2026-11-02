#!/usr/bin/env node
/**
 * Builds the Chromium extension into ./dist with esbuild (no remote code, no eval).
 *   node build.mjs            production build
 *   node build.mjs --dev      includes the synthetic indicator set (reserved .test names) for local testing
 *   node build.mjs --watch    rebuild on change
 */
import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const dev = process.argv.includes("--dev");
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
manifest.version = pkg.version;
if (dev) manifest.name = "AdTripwire (dev build with synthetic test indicators)";
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

if (existsSync(join(here, "public"))) cpSync(join(here, "public"), dist, { recursive: true });
// Chromium requires raster icons: write minimal PNGs (neutral tripwire motif, 48/96 px).
import("./icons.mjs").then(({ writeIcons }) => writeIcons(join(dist, "icons")));

const common = {
  bundle: true,
  format: "esm",
  target: ["chrome120"],
  platform: "browser",
  sourcemap: dev ? "inline" : false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
  define: {
    __ADTRIPWIRE_VERSION__: JSON.stringify(pkg.version),
    __ADTRIPWIRE_DEV__: JSON.stringify(dev),
  },
  outdir: dist,
  entryPoints: {
    background: join(here, "src/background.ts"),
    popup: join(here, "src/popup.ts"),
    dashboard: join(here, "src/dashboard.ts"),
  },
};

// The optional page sensor is a content script: classic script (IIFE), separate bundle.
const pageSensor = {
  ...common,
  format: "iife",
  entryPoints: { "page-sensor": join(here, "src/page-sensor.ts") },
};

if (watch) {
  const ctx = await context(common);
  await ctx.watch();
  const ctx2 = await context(pageSensor);
  await ctx2.watch();
  console.log("watching…");
} else {
  await build(common);
  await build(pageSensor);
  // Guard: the production bundle must not contain eval/new Function or reserved test TLD names.
  const bg = readFileSync(join(dist, "background.js"), "utf8");
  const bad = [];
  if (/\beval\s*\(/.test(bg.replace(/["'`][^"'`]*["'`]/g, ""))) bad.push("eval(");
  if (!dev && /synthetic-adfection\.test/.test(bg))
    bad.push("synthetic indicators in production bundle");
  if (bad.length) {
    console.error("Build guard failed:", bad.join(", "));
    process.exit(1);
  }
  console.log(`built ${dev ? "DEV" : "production"} bundle v${pkg.version} → ${dist}`);
}
