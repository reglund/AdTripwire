#!/usr/bin/env node
/**
 * Browser-level verification: builds a DEV bundle, starts the synthetic fixture server,
 * launches headless Firefox via web-ext with the extension, opens the fixture scenarios,
 * and asserts the expected detections appear in the extension's console output.
 *
 * Requires a local Firefox (snap or native). Not run in CI by default.
 *   pnpm e2e:firefox            headless
 *   pnpm e2e:firefox --headed   visible window (closes after the run)
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PORT = 8787;
const RUN_SECONDS = Number(process.env.E2E_SECONDS ?? 90);
const headed = process.argv.includes("--headed");
const DOMAINS = [
  "publisher.synthetic-site.test",
  "ads.synthetic-benign.test",
  "noas.synthetic-adfection.test",
  "c2.synthetic-adfection.test",
  "validator.synthetic-adfection.test",
  "staging.synthetic-dsp.test",
];
const EXPECTED = [
  "[AdTripwire] ready:",
  "detection known_infra.surveillance_contact [elevated]",
  "detection ad_delivery.noas_request [suspicious]",
  "detection js.hidden_iframe_injection [suspicious]",
  "detection known_infra.malicious_contact [elevated]",
  "detection correlation.adfection_chain [high_priority]",
  // The arrow is emitted as \u2192 by Firefox's stdout logger, so match up to it.
  "escalated ad_delivery.noas_selective_response suspicious",
  "[AdTripwire] dashboard rendered detections",
  "page sensor registered",
  "detection page.hidden_iframe_after_load",
];
const FORBIDDEN = [/infected/i, /spied/i, /is safe/i, /are safe/i];

console.log("building dev bundle…");
execFileSync("node", ["apps/extension-firefox/build.mjs", "--dev"], { stdio: "inherit" });

const fixture = spawn("node", ["scripts/fixture-server.mjs", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
});
let fixtureErr = "";
fixture.stderr.on("data", (d) => (fixtureErr += d.toString()));
await new Promise((r) => setTimeout(r, 800));
if (fixture.exitCode !== null || /EADDRINUSE/.test(fixtureErr)) {
  console.error(
    `fixture server failed to start on port ${PORT} (already in use?). Stop the other process and retry.`,
  );
  process.exit(2);
}

// Snap-packaged Firefox cannot read profiles under /tmp; use a profile under $HOME.
const snapCommon = join(homedir(), "snap", "firefox", "common");
const profile = existsSync(snapCommon)
  ? join(snapCommon, "adtripwire-e2e-profile")
  : join(homedir(), ".cache", "adtripwire-e2e-profile");
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

const urls = ["/benign", "/exposure", "/selected", "/ioc"].map(
  (p) => `http://publisher.synthetic-site.test:${PORT}${p}`,
);
const args = [
  "exec",
  "web-ext",
  "run",
  "-s",
  "apps/extension-firefox/dist",
  "--no-input",
  "--verbose",
  `--firefox-profile=${profile}`,
  "--profile-create-if-missing",
  "--keep-profile-changes",
  "--pref",
  `network.dns.localDomains=${DOMAINS.join(",")}`,
  "--pref",
  "devtools.console.stdout.chrome=true",
  // Extension pages run in the extension content process: their console goes via this pref.
  "--pref",
  "devtools.console.stdout.content=true",
  ...(headed ? [] : ["--arg=-headless"]),
  ...urls.flatMap((u) => ["--start-url", u]),
];
console.log(`launching Firefox for ${RUN_SECONDS}s…`);
const ff = spawn("pnpm", args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
const killGroup = (signal) => {
  try {
    process.kill(-ff.pid, signal);
  } catch {
    try {
      ff.kill(signal);
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
process.on("exit", () => killGroup("SIGKILL"));
let log = "";
ff.stdout.on("data", (d) => (log += d.toString()));
ff.stderr.on("data", (d) => (log += d.toString()));
await new Promise((r) => setTimeout(r, RUN_SECONDS * 1000));
killGroup("SIGTERM"); // whole group: pnpm → web-ext → Firefox
setTimeout(() => killGroup("SIGKILL"), 3000).unref();
fixture.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 1500));

const logDir = join("node_modules", ".cache", "adtripwire");
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, "e2e-firefox.log");
writeFileSync(logFile, log);
console.log(`full web-ext/Firefox log: ${logFile}`);

const lines = log
  .split("\n")
  .filter((l) => l.includes("[AdTripwire]"))
  .map((l) => l.replace(/^.*Firefox stdout: /, ""));
console.log("\n--- extension console ---");
for (const l of [...new Set(lines)]) console.log(l.slice(0, 220));

let failed = false;
for (const e of EXPECTED) {
  const ok = log.includes(e);
  console.log(`${ok ? "PASS" : "FAIL"}  ${e}`);
  if (!ok) failed = true;
}
const uiErrors = log
  .split("\n")
  .map((l) => l.split("console.error: ")[1])
  .filter((msg) => msg !== undefined && /moz-extension:\/\/|\[AdTripwire\]/.test(msg));
if (uiErrors.length > 0) {
  console.log("FAIL  extension pages logged errors:");
  for (const l of uiErrors) console.log("  " + l.slice(0, 200));
  failed = true;
} else {
  console.log("PASS  no console errors from extension pages");
}
for (const re of FORBIDDEN) {
  if (lines.some((l) => re.test(l))) {
    console.log(`FAIL  forbidden wording ${re}`);
    failed = true;
  }
}
if (!log.includes("[AdTripwire] ready:")) {
  console.log("\nThe extension never reported ready. Last log lines:");
  for (const l of log.trim().split("\n").slice(-15)) console.log("  " + l.slice(0, 200));
}
process.exit(failed ? 1 : 0);
