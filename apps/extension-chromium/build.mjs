#!/usr/bin/env node
/**
 * Builds the Chromium extension into ./dist with esbuild (no remote code, no eval).
 *   node build.mjs            production build
 *   node build.mjs --dev      includes the synthetic indicator set (reserved .test names) for local testing
 *   node build.mjs --watch    rebuild on change
 *   node build.mjs --assist   optional local-model assistance: adds a loopback-only connect-src
 *                             (http://127.0.0.1 only) and the assist UI; the default
 *                             build keeps connect-src 'none' and contains no network code path.
 */
import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const dist = outArg ? outArg.slice("--out=".length) : join(here, "dist");
const dev = process.argv.includes("--dev");
const watch = process.argv.includes("--watch");
const assist = process.argv.includes("--assist");
// --eval: production indicators, but the dashboard opens on install so an automated evaluation
// run (scripts/exposure-run.mjs) can query the extension through its own UI protocol.
const evalMode = process.argv.includes("--eval");
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
manifest.version = pkg.version;
if (dev) manifest.name = "AdTripwire (dev build with synthetic test indicators)";
if (evalMode) manifest.name = `${manifest.name} (evaluation build)`;
if (assist) {
  manifest.name = `${manifest.name} (local assist build)`;
  const csp = manifest.content_security_policy.extension_pages;
  if (!csp.includes("connect-src 'none'"))
    throw new Error("manifest CSP must start from connect-src 'none'");
  manifest.content_security_policy.extension_pages = csp.replace(
    "connect-src 'none'",
    "connect-src http://127.0.0.1:*",
  );
}
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

if (existsSync(join(here, "public"))) cpSync(join(here, "public"), dist, { recursive: true });
// Chromium requires raster icons: write minimal PNGs (neutral tripwire motif, 48/96 px).
const { writeIcons } = await import("./icons.mjs");
writeIcons(join(dist, "icons"));

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
    __ADTRIPWIRE_ASSIST__: JSON.stringify(assist),
    __ADTRIPWIRE_EVAL__: JSON.stringify(evalMode),
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
  // Guard: no bundle may contain eval/new Function, and production bundles no reserved test
  // TLD names. Quoted spans are stripped first so string literals do not trigger it.
  const bad = [];
  for (const name of ["background.js", "popup.js", "dashboard.js", "page-sensor.js"]) {
    const code = readFileSync(join(dist, name), "utf8");
    const unquoted = code.replace(/["'`][^"'`]*["'`]/g, "");
    if (/\beval\s*\(/.test(unquoted)) bad.push(`${name}: eval(`);
    if (/\bnew\s+Function\s*\(/.test(unquoted)) bad.push(`${name}: new Function(`);
    if (!dev && /synthetic-adfection\.test/.test(code))
      bad.push(`${name}: synthetic indicators in production bundle`);
    // Without --assist no bundle may carry any network client code at all; with it, only
    // the dashboard may.
    const net =
      /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\s*\(|\/api\/(?:chat|tags)|127\.0\.0\.1:/;
    if ((!assist || name !== "dashboard.js") && net.test(unquoted))
      bad.push(
        `${name}: network client code present (${assist ? "outside the dashboard" : "non-assist build"})`,
      );
    if (!dev && /assist selftest|signed bundle selftest/.test(code))
      bad.push(`${name}: self-test code in production bundle`);
  }
  const builtManifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  const builtCsp = builtManifest.content_security_policy.extension_pages;
  if (!assist && !builtCsp.includes("connect-src 'none'"))
    bad.push("manifest: connect-src must be 'none' without --assist");
  if (assist && !/connect-src http:\/\/127\.0\.0\.1:\*;/.test(builtCsp))
    bad.push("manifest: assist build must restrict connect-src to loopback");
  if (bad.length) {
    console.error("Build guard failed:", bad.join(", "));
    process.exit(1);
  }
  console.log(
    `built ${dev ? "DEV" : "production"}${assist ? " +assist" : ""}${evalMode ? " +eval" : ""} bundle v${pkg.version} → ${dist}`,
  );
}
