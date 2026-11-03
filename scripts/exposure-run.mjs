#!/usr/bin/env node
/**
 * Interactive exposure run: drives a real browser with the PRODUCTION indicator set through
 * puppeteer-core, accepts consent dialogs, scrolls, opens one article per site and dwells,
 * so programmatic ad auctions actually fire. Reads results through the extension's own UI
 * protocol (get_status / list_detections) from its dashboard page, so no console parsing is
 * needed and a web page cannot forge results. Profiles persist between runs so cookies,
 * consent and the repeated-exposure rule carry over across days.
 *
 *   node scripts/exposure-run.mjs --browser=chromium|firefox [--dist=<eval build dir>]
 *        [--sites=tests/fixtures/exposure-sites.txt] [--seconds=75] [--mobile] [--limit=N]
 *        [--profile=<dir>] [--headed] [--out=docs/evaluations/<date>-exposure-interactive-<browser>.md]
 *        [--json=<path>]
 *
 * Build the evaluation bundle first (production indicators, dashboard opens on install):
 *   node apps/extension-<browser>/build.mjs --eval --out=<dir>
 * Nothing here contacts known malicious infrastructure on purpose; the sites are mainstream
 * publishers. Reports contain counts, rule ids, severities and, for elevated or higher,
 * the detection's sanitized subject hostnames.
 */
/* global document, window, location, getComputedStyle */
// (the globals above are used only inside page.evaluate callbacks that run in the browser)
import puppeteer, { KnownDevices } from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const arg = (k, d) =>
  (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const flag = (k) => process.argv.includes(`--${k}`);
const BROWSER = arg("browser", "chromium");
if (BROWSER !== "chromium" && BROWSER !== "firefox")
  throw new Error("--browser must be chromium or firefox");
const SNAP_COMMON = join(homedir(), "snap", BROWSER, "common");
const DIST = arg("dist", join(SNAP_COMMON, "adtripwire-eval-dist"));
const SITES_PATH = arg("sites", "tests/fixtures/exposure-sites.txt");
const SECONDS = Number(arg("seconds", "75"));
const LIMIT = Number(arg("limit", "0"));
// --device=<puppeteer KnownDevices name> emulates a phone; --mobile is shorthand for iPhone 15.
const DEVICE = arg("device", flag("mobile") ? "iPhone 15" : "");
if (DEVICE && !KnownDevices[DEVICE]) throw new Error(`unknown --device "${DEVICE}"`);
const MOBILE = DEVICE !== "";
const DEVICE_SLUG = DEVICE.toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const HEADED = flag("headed");
// --etp-off: Firefox only; disables Enhanced Tracking Protection (tracking-content blocking and
// third-party cookie partitioning) to see what the default protection hides.
const ETP_OFF = flag("etp-off");
const PROFILE = arg(
  "profile",
  join(SNAP_COMMON, `adtripwire-exposure-profile${MOBILE ? `-${DEVICE_SLUG}` : ""}`),
);
const today = new Date().toISOString().slice(0, 10);
const OUT = arg(
  "out",
  `docs/evaluations/${today}-exposure-interactive-${BROWSER}${MOBILE ? `-${DEVICE_SLUG}` : ""}.md`,
);
const JSON_OUT = arg("json", "");
const ACCEPT_LANGUAGE = "nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7";

if (!existsSync(join(DIST, "manifest.json"))) {
  console.error(
    `no extension at ${DIST}; build with: node apps/extension-${BROWSER}/build.mjs --eval --out=${DIST}`,
  );
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
if (!/evaluation build/.test(manifest.name)) {
  console.error(`${DIST} is not an evaluation build (manifest name: ${manifest.name})`);
  process.exit(2);
}

const sites = readFileSync(SITES_PATH, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .slice(0, LIMIT > 0 ? LIMIT : undefined);

const CONSENT_RE =
  /^(?:godta(?: alle)?(?: informasjonskapsler)?|aksepter(?: alle)?|tillat alle|jeg forstår|jeg godtar|ok|greit|accept(?: all)?(?: cookies)?|agree(?: and continue)?|i agree|allow all|yes,? i agree|consent|got it|akzeptieren|alle akzeptieren|accepter|tout accepter|aceptar(?: todo)?)\s*[!.]?$/i;
const CONSENT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  "button#didomi-notice-agree-button",
  ".qc-cmp2-summary-buttons button[mode=primary]",
  "button[data-testid=uc-accept-all-button]",
  "#sp_message_container button.sp_choice_type_11",
  "button.sp_choice_type_11",
  "button[title='Godta alle']",
  "button[title='Accept all']",
  "#acceptAllButton",
  "#accept-all",
  ".cmp-accept-all",
];

/** Clicks a consent control in any frame. Returns the frame url + label when something was clicked. */
async function clickConsent(page) {
  for (const frame of page.frames()) {
    try {
      const clicked = await frame.evaluate(
        (selectors, reSource) => {
          const re = new RegExp(reSource, "i");
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return (
              r.width > 10 && r.height > 10 && cs.visibility !== "hidden" && cs.display !== "none"
            );
          };
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && visible(el)) {
              el.click();
              return `selector ${sel}`;
            }
          }
          const candidates = document.querySelectorAll(
            "button, a, [role=button], input[type=button], input[type=submit]",
          );
          for (const el of candidates) {
            const text = (el.innerText || el.value || el.getAttribute("aria-label") || "")
              .trim()
              .replace(/\s+/g, " ");
            if (text.length > 0 && text.length < 40 && re.test(text) && visible(el)) {
              el.click();
              return `text "${text}"`;
            }
          }
          return null;
        },
        CONSENT_SELECTORS,
        CONSENT_RE.source,
      );
      if (clicked) return clicked;
    } catch {
      /* frame navigated or detached */
    }
  }
  return null;
}

async function scrollThrough(page, steps, pauseMs) {
  for (let i = 0; i < steps; i++) {
    try {
      await page.evaluate(() =>
        window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: "instant" }),
      );
    } catch {
      return;
    }
    await sleep(pauseMs);
  }
}

async function pickArticle(page, siteHost) {
  try {
    return await page.evaluate((host) => {
      const bare = host.replace(/^www\./, "");
      const links = Array.from(document.querySelectorAll("a[href]"));
      for (const a of links) {
        let u;
        try {
          u = new URL(a.href, location.href);
        } catch {
          continue;
        }
        if (u.protocol !== "https:" && u.protocol !== "http:") continue;
        if (!u.hostname.replace(/^www\./, "").endsWith(bare)) continue;
        if (u.pathname.length < 15 || /\/(?:tag|search|login|video|live)\b/i.test(u.pathname))
          continue;
        const text = (a.innerText || "").trim();
        if (text.length < 25) continue;
        return u.href;
      }
      return null;
    }, siteHost);
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Registrable domain from the bundled Public Suffix List (same data the extension uses), so the
// third-party count is measured by the runner itself from the page's own requests and does not
// depend on extension state (a Firefox event page can be suspended, which resets in-memory sets).
const PSL = JSON.parse(readFileSync("packages/indicators/data/public-suffix-list.json", "utf8"));
const PSL_RULES = new Set(PSL.rules ?? []);
function registrable(host) {
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

let initialPages = [];

async function launch() {
  mkdirSync(PROFILE, { recursive: true });
  if (BROWSER === "chromium") {
    // Chromium caches an unpacked extension's service-worker script in the profile and keeps
    // running it after the extension files change (even with a new version). Clear that cache
    // so a persistent evaluation profile always runs the freshly built background code.
    rmSync(join(PROFILE, "Default", "Service Worker"), { recursive: true, force: true });
    const bin = process.env.CHROME_BIN ?? execFileSync("which", ["chromium"]).toString().trim();
    return puppeteer.launch({
      executablePath: bin,
      headless: !HEADED,
      userDataDir: PROFILE,
      protocolTimeout: 120_000,
      args: [
        `--load-extension=${DIST}`,
        `--disable-extensions-except=${DIST}`,
        `--lang=nb-NO`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-component-update",
        "--disable-sync",
        ...(MOBILE ? [] : ["--window-size=1366,900"]),
      ],
    });
  }
  const browser = await puppeteer.launch({
    browser: "firefox",
    executablePath: process.env.FIREFOX_BIN ?? "/snap/bin/firefox",
    headless: !HEADED,
    userDataDir: PROFILE,
    protocolTimeout: 120_000,
    // WebDriver BiDi refuses to evaluate inside extension pages (reported as about:blank)
    // unless system access is allowed; needed only for this evaluation harness.
    args: ["-remote-allow-system-access"],
    extraPrefsFirefox: {
      "intl.accept_languages": ACCEPT_LANGUAGE,
      "intl.locale.requested": "nb-NO",
      ...(ETP_OFF
        ? {
            "browser.contentblocking.category": "custom",
            "privacy.trackingprotection.enabled": false,
            "privacy.trackingprotection.pbmode.enabled": false,
            "privacy.trackingprotection.socialtracking.enabled": false,
            "privacy.trackingprotection.cryptomining.enabled": false,
            "privacy.trackingprotection.fingerprinting.enabled": false,
            "network.cookie.cookieBehavior": 0,
          }
        : {}),
    },
  });
  initialPages = await browser.pages();
  await browser.installExtension(DIST);
  return browser;
}

/** The extension's dashboard page, opened by the evaluation build on install. */
async function dashboardPage(browser) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const p of await browser.pages()) {
      if (/^(?:chrome|moz)-extension:\/\/[^/]+\/dashboard\.html/.test(p.url())) return p;
      // Firefox over BiDi reports extension pages as about:blank: take the tab that appeared
      // after install and confirm it answers the extension protocol.
      if (BROWSER === "firefox" && !initialPages.includes(p)) {
        try {
          const ok = await p.evaluate(
            () => /dashboard\.html/.test(location.href) && typeof browser === "object",
          );
          if (ok) return p;
        } catch {
          /* not ready yet */
        }
      }
    }
    await sleep(1000);
  }
  throw new Error(
    "the extension did not open its dashboard within 60 s (is this an --eval build?)",
  );
}

async function rpc(dash, req) {
  return dash.evaluate((r) => {
    const api = globalThis.browser ?? globalThis.chrome;
    return api.runtime.sendMessage(r);
  }, req);
}

async function status(dash) {
  const res = await rpc(dash, { type: "get_status" });
  if (!res?.ok) throw new Error(`get_status failed: ${res?.error}`);
  return res.data;
}

async function main() {
  console.log(
    `exposure run: ${BROWSER}${MOBILE ? ` (${DEVICE} emulation)` : ""}, ${sites.length} sites, ${SECONDS}s each, profile ${PROFILE}`,
  );
  const browser = await launch();
  const dash = await dashboardPage(browser);
  // Long-term mapping: keep detections for a year (the default 7 days would erase history
  // between daily runs) and enable the opt-in page sensor for structural signals.
  const tuned = await rpc(dash, {
    type: "update_settings",
    patch: {
      detectionRetentionDays: 365,
      maxDetections: 50_000,
      maxEvents: 200_000,
      pageSensorEnabled: true,
    },
  });
  if (!tuned?.ok) console.warn(`could not apply evaluation settings: ${tuned?.error}`);
  const start = await status(dash);
  console.log(
    `extension ${start.productVersion}, ${start.indicatorSets.length} indicator set(s), monitoring=${start.monitoring}, caps=${start.capabilities.capabilities.join(",")}`,
  );
  if (!start.monitoring) console.warn("WARNING: monitoring is not active (host permission?)");
  const knownDetections = new Set(
    (await rpc(dash, { type: "list_detections" })).data.map((d) => d.detectionId),
  );

  const results = [];
  let prev = start;
  for (const [i, url] of sites.entries()) {
    const host = new URL(url).hostname;
    const row = {
      site: host,
      loaded: false,
      consent: null,
      article: false,
      events: 0,
      thirdPartyDomains: 0,
      detections: [],
    };
    const t0 = Date.now();
    const page = await browser.newPage();
    const firstParty = registrable(host);
    const seenThirdParty = new Set();
    page.on("request", (req) => {
      try {
        const u = new URL(req.url());
        if (u.protocol !== "http:" && u.protocol !== "https:") return;
        const d = registrable(u.hostname);
        if (d !== firstParty) seenThirdParty.add(d);
      } catch {
        /* ignore malformed */
      }
    });
    try {
      if (MOBILE) await page.emulate(KnownDevices[DEVICE]);
      try {
        await page.setExtraHTTPHeaders({ "Accept-Language": ACCEPT_LANGUAGE });
      } catch {
        /* not supported on this protocol */
      }
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      row.loaded = true;
      for (let k = 0; k < 4 && !row.consent; k++) {
        await sleep(2500);
        row.consent = await clickConsent(page);
      }
      await scrollThrough(page, 6, 1500);
      const article = await pickArticle(page, host);
      if (article) {
        try {
          await page.goto(article, { waitUntil: "domcontentloaded", timeout: 30_000 });
          row.article = true;
          await sleep(2000);
          if (!row.consent) row.consent = await clickConsent(page);
          await scrollThrough(page, 5, 1500);
        } catch {
          /* article failed to load; keep the home page dwell */
        }
      }
      const remaining = SECONDS * 1000 - (Date.now() - t0);
      if (remaining > 0) await sleep(remaining);
    } catch (err) {
      row.error = err instanceof Error ? err.message.split("\n")[0].slice(0, 120) : String(err);
    } finally {
      await page.close().catch(() => {});
    }
    // Let late requests settle, then read the extension's own counters.
    await sleep(3000);
    let cur;
    try {
      cur = await status(dash);
    } catch (err) {
      row.error = `status unavailable: ${err instanceof Error ? err.message : String(err)}`;
      results.push(row);
      continue;
    }
    row.events = Math.max(
      0,
      (cur.metrics?.eventsObserved ?? 0) - (prev.metrics?.eventsObserved ?? 0),
    );
    row.thirdPartyDomains = seenThirdParty.size;
    const list = (await rpc(dash, { type: "list_detections" })).data;
    for (const d of list) {
      if (knownDetections.has(d.detectionId)) continue;
      knownDetections.add(d.detectionId);
      row.detections.push({
        ruleId: d.ruleId,
        severity: d.severity,
        // Hosts are shown for elevated and above and for every contact with documented
        // infrastructure; routine ad-tech rules keep their hosts out of the report.
        hostnames:
          ["elevated", "high_priority"].includes(d.severity) || d.ruleId.startsWith("known_infra.")
            ? d.subjectHostnames
            : undefined,
      });
    }
    prev = cur;
    results.push(row);
    console.log(
      `${String(i + 1).padStart(2)}/${sites.length} ${host.padEnd(28)} loaded=${row.loaded ? "y" : "n"} consent=${row.consent ? "y" : "n"} article=${row.article ? "y" : "n"} events=+${row.events} 3p-domains=+${row.thirdPartyDomains} detections=${row.detections.length}${row.error ? ` error=${row.error}` : ""}`,
    );
  }
  const end = await status(dash);
  await browser.close();

  const totals = {
    sites: results.length,
    loaded: results.filter((r) => r.loaded).length,
    consent: results.filter((r) => r.consent).length,
    article: results.filter((r) => r.article).length,
    events: results.reduce((a, r) => a + r.events, 0),
    thirdPartyMedian: (() => {
      const v = results
        .filter((r) => r.loaded)
        .map((r) => r.thirdPartyDomains)
        .sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : 0;
    })(),
    lowAuction: results.filter((r) => r.loaded && r.thirdPartyDomains < 10).length,
    detections: results.flatMap((r) => r.detections),
  };
  const bySev = {};
  for (const d of totals.detections) bySev[d.severity] = (bySev[d.severity] ?? 0) + 1;
  const sevOrder = ["high_priority", "elevated", "suspicious", "informational"];

  const L = [];
  L.push(
    `# Interactive exposure run, ${BROWSER}${MOBILE ? ` (${DEVICE} emulation)` : ""} — ${today}`,
  );
  L.push("");
  L.push(
    `Script: \`scripts/exposure-run.mjs\`. Evaluation build ${end.productVersion} (production indicator set, ${end.indicatorSets.map((s) => `${s.id} ${s.version}`).join(", ")}), ${HEADED ? "headed" : "headless"} ${BROWSER}, persistent profile \`${PROFILE.replace(homedir(), "~")}\`, ${SECONDS} s per site, consent accepted where a dialog was recognised, scrolled, one article opened. Capabilities: ${end.capabilities.capabilities.join(", ")}.`,
  );
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push(
    `- Sites: ${totals.sites}; loaded ${totals.loaded}; consent clicked on ${totals.consent} (no click means no dialog was recognised, or consent was already stored in this persistent profile); article opened on ${totals.article}.`,
  );
  L.push(
    `- Requests observed by the sensor: ${totals.events}. Third-party registrable domains per site, counted by this script from the page's own requests: median ${totals.thirdPartyMedian}; ${totals.lowAuction} loaded site(s) contacted fewer than 10, which suggests few or no ad auctions ran there.`,
  );
  L.push(
    `- Detections: ${totals.detections.length}${
      totals.detections.length
        ? ` (${sevOrder
            .filter((s) => bySev[s])
            .map((s) => `${bySev[s]} ${s}`)
            .join(", ")})`
        : ""
    }. Contact with documented infrastructure (rules known_infra.*): ${totals.detections.filter((d) => d.ruleId.startsWith("known_infra.")).length}.`,
  );
  L.push(
    `- Cumulative in this profile: ${end.counts.detectionsTotal} detections, ${end.counts.knownIocObservations} known-infrastructure observations, ${end.counts.highPriority} high priority.`,
  );
  L.push("");
  L.push("## Per site");
  L.push("");
  L.push(
    "| # | Site | Loaded | Consent clicked | Article | Requests (sensor) | 3rd-party domains (page) | Detections |",
  );
  L.push("|---:|---|:-:|---|:-:|---:|---:|---|");
  results.forEach((r, i) =>
    L.push(
      `| ${i + 1} | ${r.site} | ${r.loaded ? "yes" : "no"} | ${r.consent ? r.consent.replace(/\|/g, "/") : "—"} | ${r.article ? "yes" : "no"} | ${r.events} | ${r.thirdPartyDomains} | ${r.detections.length ? r.detections.map((d) => `${d.ruleId} [${d.severity}]`).join("<br>") : "—"}${r.error ? `<br>error: ${r.error.replace(/\|/g, "/")}` : ""} |`,
    ),
  );
  L.push("");
  L.push("## Detections");
  L.push("");
  if (totals.detections.length === 0) L.push("None during this run.");
  else {
    L.push(
      "| Rule | Severity | Site | Subject hostnames (documented infrastructure, elevated and above) |",
    );
    L.push("|---|---|---|---|");
    for (const r of results)
      for (const d of r.detections)
        L.push(
          `| \`${d.ruleId}\` | ${d.severity} | ${r.site} | ${d.hostnames ? d.hostnames.join(", ") : "—"} |`,
        );
  }
  L.push("");
  L.push("## Reading this");
  L.push("");
  L.push(
    "- Results come from the extension's own UI protocol (status and detection list), not from parsed console output, so a page cannot forge them.",
  );
  L.push(
    "- No detection of a documented host means that host did not appear in the ad auctions this profile took part in during this run; it says nothing about other profiles, networks, devices or days. The repeated-exposure rule needs three distinct days in the same profile.",
  );
  L.push(
    "- Consent recognition is heuristic; sites where consent was not clicked ran fewer or no auctions.",
  );
  writeFileSync(OUT, L.join("\n") + "\n");
  if (JSON_OUT)
    writeFileSync(
      JSON_OUT,
      JSON.stringify(
        {
          date: today,
          browser: BROWSER,
          device: DEVICE || null,
          sites: SITES_PATH,
          etpOff: ETP_OFF,
          seconds: SECONDS,
          totals,
          results,
        },
        null,
        2,
      ),
    );
  console.log(`report → ${OUT}`);
}

await main();
