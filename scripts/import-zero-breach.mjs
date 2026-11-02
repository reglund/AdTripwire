#!/usr/bin/env node
/**
 * Reproducible import of the Zero Breach AdFection indicator list (CC0 1.0) into
 * AdTripwire's normalized indicator format.
 *
 * Usage: node scripts/import-zero-breach.mjs [input.tsv] [output.json]
 *
 * Curation policy (see docs/detection-methodology.md):
 *  - Import only current-campaign PRIMARY indicators (Citizen Lab 2026, Confiant 2026)
 *    and Recorded Future's 2025 Candiru domain set (independent attribution).
 *  - Skip IP addresses (cloud IPs are reassigned; a browser sensor sees hostnames),
 *    file hashes, the vulnerable-driver hash, and 2021-2022 historical sets.
 *  - Re-classify every row into AdTripwire's three classes explicitly below.
 */
import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2] ?? "packages/indicators/upstream/zero-breach/adfection_iocs.txt";
const output = process.argv[3] ?? "packages/indicators/data/adfection-2026.json";

const SOURCES = {
  "citizenlab-adfection-2026": {
    name: "The Citizen Lab — Exposing AdFection",
    url: "https://citizenlab.ca/research/how-discover-tech-turned-targeted-ads-into-a-pipeline-for-spyware/",
    published: "2026-10-15",
  },
  "confiant-adint-2026": {
    name: "Confiant — ADINT: Weaponized Ad Tech for Zero-Click Spyware and Mass Identity Vacuuming",
    url: "https://blog.confiant.com/p/adint-weaponized-ad-tech-for-zero-click-spyware-and-mass-identity-vacuuming",
    published: "2026-10-15",
  },
  "recordedfuture-2025-08": {
    name: "Recorded Future / Insikt Group — Tracking Candiru's DevilsTongue Spyware (CTA-2025-0805)",
    url: "https://www.recordedfuture.com/research/tracking-candirus-devilstongue-spyware",
    published: "2025-08-05",
  },
};

// Apex domains listed as wildcards in Citizen Lab Appendix C ("General").
const APPENDIX_C_GENERAL = new Set([
  "discover-tech.io",
  "mtrtb.com",
  "mydsp.io",
  "controlium.net",
  "powerium.net",
  "platc-tester.com",
  "myweb3id.io",
  "myipinfo.io",
  "akedo.gg",
  "volasim.com",
]);
// Corporate / consumer-app / attribution hosts: a lead, not a finding.
const CONTEXTUAL = new Set([
  "discover-tech.io",
  "www.discover-tech.io",
  "mydsp.io",
  "akedo.gg",
  "volasim.com",
  "myipinfo.io",
  "adtimizer.co",
  "discovertech-alb-100966113.us-east-1.elb.amazonaws.com",
  "msstore.io",
  "adtracker.link",
  "cdnmobile.io",
]);
const NOAS_HOST = /^(noas|infinoas|ppv2|pqv2|qa-noas)\./;
const TRACKING = new Set([
  "tracookiepixel.xyz",
  "cookiesurfer.com",
  "cookie-sync.xyz",
  "ads-monitor.xyz",
  "checkmyimp.com",
  "ads-impressions.com",
  "nutralove.co",
  "tracker.mtrtb.com",
]);
const BINDECY = new Set(["archer.westeurope.cloudapp.azure.com", "bd-mainserver.herokuapp.com"]);
// Hosts Citizen Lab groups with Candiru profiling / loader activity.
const PROFILING = new Set(["sincereaccertain.com"]);

const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
const isHash = (s) => /^[0-9a-f]{64}$/i.test(s);

const rows = readFileSync(input, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("\t"))
  .filter((c) => c.length === 4);

const out = [];
const skipped = { ip: 0, hash: 0, historicalSecondary: 0, vulnDriver: 0, other: 0 };

for (const [indicator, tier, confidence, source] of rows) {
  const value = indicator.toLowerCase();
  if (isIp(value)) {
    skipped.ip++;
    continue;
  }
  if (isHash(value)) {
    skipped.hash++;
    continue;
  }
  if (tier === "vuln-driver" || tier === "sample") {
    skipped.vulnDriver++;
    continue;
  }
  if (confidence !== "primary") {
    skipped.historicalSecondary++;
    continue;
  }
  const src = SOURCES[source];
  if (!src) {
    skipped.other++;
    continue;
  }

  let classification, role, conf, notes;
  const labels = value.split(".").length;
  const isCloudFront = value.endsWith(".cloudfront.net");

  if (tier === "cc") {
    classification = "malicious";
    role = BINDECY.has(value) ? "c2-bindecy" : "c2";
    conf = "high";
    notes = BINDECY.has(value)
      ? "Bindecy command-and-control on shared cloud hosting; hostname is specific but the platform is not."
      : "Candiru command-and-control (Citizen Lab Fingerprint C1).";
  } else if (tier === "validator") {
    classification = "malicious";
    role = "validator";
    conf = "high";
    notes =
      "Candiru validator / target-selection server (Fingerprint V1). Only 2 of 305 validator domains are public.";
  } else if (tier === "candiru") {
    classification = "malicious";
    role = "candiru-attributed";
    conf = "medium";
    notes =
      "Candiru-attributed infrastructure from Recorded Future 2025 appendix; role (C2 vs operator) unspecified; may have lapsed.";
  } else if (tier === "delivery" || tier === "historical") {
    if (CONTEXTUAL.has(value)) {
      classification = "contextual";
      role = tier === "historical" ? "historical" : "corporate";
      conf = "medium";
      notes =
        tier === "historical"
          ? "Historical Discover-Tech domain named in the 2026 report; may be lapsed or re-registered."
          : "Operator-linked corporate, consumer-app, or hosting name. Contact is a lead for analysts, not a finding.";
    } else if (PROFILING.has(value)) {
      classification = "malicious";
      role = "profiling-loader";
      conf = "medium";
      notes =
        "Citizen Lab associates this host with Candiru-linked profiling (?qq= loader pattern).";
    } else if (value === "pagead.trustlayersdk.com") {
      classification = "malicious";
      role = "sdk-c2";
      conf = "medium";
      notes =
        "Confiant: command endpoint for the ad-embedded SDK that polls for and executes operator-pushed code.";
    } else if (isCloudFront) {
      classification = "surveillance";
      role = "staging";
      conf = "medium";
      notes =
        "CloudFront distribution used for ?impid= / ?qq= iframe staging. Time-bounded: distributions rotated within days; CloudFront names can be reassigned.";
    } else if (NOAS_HOST.test(value)) {
      classification = "surveillance";
      role = "noas";
      conf = "high";
      notes =
        "NOAS / getAd ad-serving endpoint: decides server-side which devices receive JavaScript. Most responses are empty; contact alone indicates exposure, not selection.";
    } else if (TRACKING.has(value)) {
      classification = "surveillance";
      role = "tracking";
      conf = "high";
      notes =
        "Discover-Tech cookie-sync / impression tracking. Very high volume; exposure is common and is not evidence of targeting.";
    } else if (APPENDIX_C_GENERAL.has(value)) {
      classification = "surveillance";
      role = "operator-infrastructure";
      conf = "medium";
      notes =
        "Apex of Discover-Tech / Controlium operational infrastructure (Citizen Lab Appendix C). Matches all subdomains.";
    } else {
      classification = "surveillance";
      role = "delivery";
      conf = "medium";
      notes = "Delivery / logging host named in the report body.";
    }
  } else {
    skipped.other++;
    continue;
  }

  const indicatorType =
    labels <= 2 ||
    APPENDIX_C_GENERAL.has(value) ||
    tier === "cc" ||
    tier === "candiru" ||
    tier === "validator"
      ? "domain"
      : "hostname";
  // Shared-hosting platforms must never be matched as domains.
  const type =
    BINDECY.has(value) || isCloudFront || value.includes(".elb.amazonaws.com")
      ? "hostname"
      : indicatorType;

  out.push({
    indicator: value,
    indicatorType: type,
    source: src.name,
    sourceUrl: src.url,
    campaign:
      tier === "candiru" ? "candiru-devilstongue" : BINDECY.has(value) ? "bindecy" : "adfection",
    classification,
    confidence: conf,
    firstReported: src.published,
    lastReviewed: "2026-11-02",
    enabled: true,
    role,
    notes,
  });
}

// Deterministic order and ids.
out.sort((a, b) => a.indicator.localeCompare(b.indicator));
const seen = new Set();
const dedup = out.filter((r) => (seen.has(r.indicator) ? false : (seen.add(r.indicator), true)));
dedup.forEach((r, i) => {
  r.id = `adf-${String(i + 1).padStart(4, "0")}`;
});
const ordered = dedup.map(({ id, ...rest }) => ({ id, ...rest }));

const set = {
  meta: {
    id: "adfection-2026",
    name: "AdFection / Discover-Tech / Candiru infrastructure",
    version: "2026.11.02",
    asOf: "2026-10-18",
    license: "CC0-1.0 (indicator data via Zero Breach; facts from the cited reports)",
    synthetic: false,
    description:
      "Curated hostnames and domains documented by Citizen Lab and Confiant (2026-10-15) and Recorded Future (2025-08-05). IPs, hashes and 2021-2022 historical sets deliberately excluded.",
    sources: Object.values(SOURCES).concat([
      {
        name: "Zero Breach (interplains/zero-breach) curated IOC list, CC0 1.0",
        url: "https://github.com/interplains/zero-breach",
        published: "2026-10-18",
      },
    ]),
  },
  indicators: ordered,
};
writeFileSync(output, JSON.stringify(set, null, 2) + "\n");
const byClass = {};
for (const r of ordered) byClass[r.classification] = (byClass[r.classification] ?? 0) + 1;
console.log(`wrote ${ordered.length} indicators to ${output}`, byClass, "skipped:", skipped);
