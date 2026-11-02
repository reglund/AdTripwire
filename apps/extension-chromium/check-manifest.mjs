#!/usr/bin/env node
/** Structural check of the built Chromium manifest (web-ext lint targets Firefox manifests). */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const dist = join(new URL(".", import.meta.url).pathname, "dist");
const m = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const errors = [];
if (m.manifest_version !== 3) errors.push("manifest_version must be 3");
if (!m.background?.service_worker) errors.push("background.service_worker missing");
for (const p of ["webRequestBlocking", "webRequestFilterResponse"])
  if (m.permissions?.includes(p)) errors.push(`Chromium build must not request ${p}`);
for (const f of [
  m.background?.service_worker,
  m.action?.default_popup,
  m.options_page,
  ...Object.values(m.icons ?? {}),
])
  if (f && !existsSync(join(dist, f))) errors.push(`missing file ${f}`);
if (!/script-src 'self'/.test(m.content_security_policy?.extension_pages ?? ""))
  errors.push("CSP must restrict script-src to 'self'");
if (m.browser_specific_settings) errors.push("browser_specific_settings is Firefox-only");
if (errors.length) {
  console.error("Chromium manifest check failed:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log(`Chromium manifest OK (${m.name} ${m.version}, ${m.permissions.length} permissions)`);
