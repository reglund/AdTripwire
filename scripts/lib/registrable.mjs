/**
 * Registrable domain from the bundled Public Suffix List (the same data the extension uses).
 * Shared by the exposure harness (scripts/exposure-run.mjs) and the observatory build, so the
 * third-party counts and the "seen alongside" baseline are computed the same way.
 * The list is resolved relative to this file, not to the working directory.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PSL = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../packages/indicators/data/public-suffix-list.json", import.meta.url),
    ),
    "utf8",
  ),
);
const PSL_RULES = new Set(PSL.rules ?? []);

export function registrable(host) {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length < 2 || /^\d+(?:\.\d+){3}$/.test(host)) return host.toLowerCase();
  let suffixLen = 1;
  for (let i = 0; i < labels.length; i++) {
    const cand = labels.slice(i).join(".");
    if (PSL_RULES.has(`!${cand}`)) {
      suffixLen = labels.length - i - 1;
      break;
    }
    const wild = ["*", ...labels.slice(i + 1)].join(".");
    if (PSL_RULES.has(cand) || (i + 1 < labels.length && PSL_RULES.has(wild))) {
      suffixLen = labels.length - i;
      break;
    }
  }
  return labels.slice(Math.max(0, labels.length - suffixLen - 1)).join(".");
}

/** True when both hostnames share a registrable domain (the page's own site, never a candidate). */
export function sameSite(a, b) {
  return registrable(a) === registrable(b);
}
