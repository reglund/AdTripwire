#!/usr/bin/env node
/**
 * Browser-level verification on Chromium (Google Chrome / Chromium): builds a DEV bundle of
 * apps/extension-chromium, starts the synthetic fixture server, launches headless Chrome with
 * the extension loaded and host-resolver rules mapping the reserved .test names to localhost,
 * opens the fixture scenarios and asserts on the extension's console output (CONSOLE lines
 * from --enable-logging=stderr).
 *
 *   pnpm e2e:chromium            headless
 *   CHROME_BIN=/path/to/chrome pnpm e2e:chromium
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";

const PORT = 8788;
const RUN_SECONDS = Number(process.env.E2E_SECONDS ?? 60);
const headed = process.argv.includes("--headed");
const DOMAINS = [
  "publisher.synthetic-site.test",
  "ads.synthetic-benign.test",
  "noas.synthetic-adfection.test",
  "c2.synthetic-adfection.test",
  "validator.synthetic-adfection.test",
  "staging.synthetic-dsp.test",
  "creative.synthetic-cdn.test",
];
const EXPECTED = [
  "[AdTripwire] ready:",
  // Toolbar badge reflects documented-infrastructure contacts (synthetic indicators).
  "[AdTripwire] badge: ",
  "[AdTripwire] dashboard rendered exposure",
  "signed bundle selftest ok key=adtripwire-2026a version=2026.11.02",
  "detection known_infra.surveillance_contact [elevated]",
  "detection ad_delivery.noas_request [suspicious]",
  "detection known_infra.malicious_contact [elevated]",
  "page sensor registered",
  "detection page.hidden_iframe_after_load",
  "[AdTripwire] dashboard rendered",
  // Seen alongside (DEV console line from the background): the non-indicator creative host in
  // the /selected ad frame is recorded at frame scope next to the NOAS anchor. Same-frame
  // relations count without frame ancestry, so Chromium is expected to record it too.
  "creative.synthetic-cdn.test@frame",
];
// Chromium cannot inspect response bodies: these must NOT appear.
const FORBIDDEN_ON_CHROMIUM = ["detection js.", "response_body_inspection"];
const FORBIDDEN_WORDING = [/infected/i, /spied/i, /is safe/i, /are safe/i];

// Google Chrome (branded) ignores --load-extension since Chrome 137; prefer Chromium builds.
const chromeBin =
  process.env.CHROME_BIN ??
  ["chromium", "chromium-browser", "chrome-for-testing", "google-chrome-unstable"].find((b) => {
    try {
      execFileSync("which", [b], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
if (!chromeBin) {
  console.error(
    "No Chromium binary found; set CHROME_BIN to a Chromium or Chrome for Testing build (branded Google Chrome ignores --load-extension).",
  );
  process.exit(2);
}

console.log("building dev bundle (chromium)…");
const withAssist = process.argv.includes("--assist");
execFileSync(
  "node",
  ["apps/extension-chromium/build.mjs", "--dev", ...(withAssist ? ["--assist"] : [])],
  {
    stdio: "inherit",
  },
);
if (withAssist) {
  EXPECTED.push(
    "[AdTripwire] assist selftest probe ok models=mock-model",
    "[AdTripwire] assist selftest flags=asserted_compromise,unknown_hostname removed=1 masked=1",
  );
}
const dist = resolve("apps/extension-chromium/dist");

const fixture = spawn("node", ["scripts/fixture-server.mjs", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
});
let fixtureErr = "";
fixture.stderr.on("data", (d) => (fixtureErr += d.toString()));
await new Promise((r) => setTimeout(r, 800));
if (fixture.exitCode !== null || /EADDRINUSE/.test(fixtureErr)) {
  console.error(`fixture server failed on port ${PORT}`);
  process.exit(2);
}

// Snap-packaged Chromium can only read profiles and extensions under $HOME. Use a fresh
// unpredictable directory (mkdtemp) and remove it on exit.
const snapCommon = join(homedir(), "snap", "chromium", "common");
const profileParent = existsSync(snapCommon) ? snapCommon : tmpdir();
mkdirSync(profileParent, { recursive: true });
const profile = mkdtempSync(join(profileParent, "adtripwire-chromium-e2e-"));
// Headless Chrome supports a single start URL; /all embeds the four scenarios as iframes.
const urls = [`http://publisher.synthetic-site.test:${PORT}/all`];
const args = [
  ...(headed ? [] : ["--headless=new"]),
  `--user-data-dir=${profile}`,
  `--load-extension=${dist}`,
  // Fail closed: only the six reserved names resolve (to the local fixture); everything else
  // is NXDOMAIN, so the run can make no outbound requests.
  // Fail-closed DNS: only the fixture hosts resolve. "MAP *" also catches IP literals in
  // Chromium's mapped resolver, so loopback is excluded explicitly (the assist self-test
  // and the fixture server live there).
  `--host-resolver-rules=${[...DOMAINS.map((d) => `MAP ${d} 127.0.0.1`), "MAP * ~NOTFOUND", "EXCLUDE localhost", "EXCLUDE 127.0.0.1"].join(", ")}`,
  "--enable-logging=stderr",
  "--v=0",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--metrics-recording-only",
  ...urls,
];
console.log(`launching ${chromeBin} for ${RUN_SECONDS}s…`);
const chrome = spawn(chromeBin, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
chrome.stdout.on("data", (d) => (log += d.toString()));
chrome.stderr.on("data", (d) => (log += d.toString()));
const killGroup = (sig) => {
  try {
    process.kill(-chrome.pid, sig);
  } catch {
    try {
      chrome.kill(sig);
    } catch {
      /* gone */
    }
  }
};
process.on("SIGINT", () => {
  killGroup("SIGTERM");
  fixture.kill("SIGTERM");
  process.exit(130);
});
chrome.on("error", (e) => {
  console.error(`could not start ${chromeBin}: ${String(e)}`);
  fixture.kill("SIGTERM");
  process.exit(2);
});
process.on("exit", () => {
  killGroup("SIGKILL");
  try {
    fixture.kill("SIGKILL");
  } catch {
    /* gone */
  }
  rmSync(profile, { recursive: true, force: true });
});
await new Promise((r) => setTimeout(r, RUN_SECONDS * 1000));
killGroup("SIGTERM");
setTimeout(() => killGroup("SIGKILL"), 3000).unref();
fixture.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 1500));

const logDir = join("node_modules", ".cache", "adtripwire");
mkdirSync(logDir, { recursive: true });
writeFileSync(join(logDir, "e2e-chromium.log"), log);
console.log(`full chrome log: ${join(logDir, "e2e-chromium.log")}`);

// Chrome console lines look like: [pid:tid:date/time.micros:INFO:CONSOLE(line)] "message", source: url (line)
const lines = [
  ...new Set(
    log
      .split("\n")
      .filter((l) => l.includes("[AdTripwire]"))
      .map((l) => l.match(/CONSOLE\(\d+\)\] "(.*)", source:/)?.[1] ?? l),
  ),
];
console.log("\n--- extension console ---");
for (const l of lines) console.log(l.slice(0, 220));

let failed = false;
for (const e of EXPECTED) {
  const ok = log.includes(e);
  console.log(`${ok ? "PASS" : "FAIL"}  ${e}`);
  if (!ok) failed = true;
}
for (const f of FORBIDDEN_ON_CHROMIUM) {
  const present = lines.some((l) => l.includes(f));
  console.log(`${present ? "FAIL" : "PASS"}  absent on Chromium: ${f}`);
  if (present) failed = true;
}
for (const re of FORBIDDEN_WORDING) {
  if (lines.some((l) => re.test(l))) {
    console.log(`FAIL  forbidden wording ${re}`);
    failed = true;
  }
}
if (!log.includes("[AdTripwire] ready:")) {
  console.log("\nThe extension never reported ready. Last log lines:");
  for (const l of log.trim().split("\n").slice(-15)) console.log("  " + l.slice(0, 200));
}
// An indicator host (already documented) is never listed as seen alongside.
if (/alongside: [^\n]*(?:staging|noas|c2|validator)\.synthetic-[a-z]+\.test@/.test(log)) {
  console.log("FAIL  an indicator host was listed as seen alongside");
  failed = true;
} else {
  console.log("PASS  no documented host listed as seen alongside");
}
// The page's own site (first-party wrapper frames, first-party requests) is never a candidate.
if (/alongside: [^\n]*publisher\.synthetic-site\.test@/.test(log)) {
  console.log("FAIL  the page's own site was listed as seen alongside");
  failed = true;
} else {
  console.log("PASS  the page's own site is not listed as seen alongside");
}
// A dashboard view that rendered its error state must fail the run, not pass as "rendered".
if (/dashboard rendered [a-z_]+ \(error state\)/.test(log)) {
  console.log("FAIL  a dashboard view rendered its error state");
  failed = true;
}
process.exit(failed ? 1 : 0);
