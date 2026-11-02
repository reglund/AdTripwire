#!/usr/bin/env node
/**
 * Reproducible import of the Zero Breach AdFection indicator list (CC0 1.0) into
 * AdTripwire's normalized indicator format.
 *
 * Usage: node scripts/import-zero-breach.mjs [input.tsv] [output.json]
 *          [--withdrawals=<stix.json>] [--strict]
 *
 *  --withdrawals  Zero Breach's withdrawals bundle: any revoked indicator whose value matches a
 *                 row is dropped (counted as "withdrawn").
 *  --strict       exit 3 when rows were skipped for an unknown source or tier, so an automated
 *                 refresh stops for human review instead of silently ignoring new data.
 *
 * Versioning: when the generated indicators are identical to the existing output, its
 * version and asOf are kept (byte-stable output). When they differ, version becomes today's
 * date (YYYY.MM.DD, monotonic for signed bundles) and asOf the upstream file's "# as-of:".
 *
 * Curation policy (see docs/detection-methodology.md):
 *  - Import only current-campaign PRIMARY indicators (Citizen Lab 2026, Confiant 2026)
 *    and Recorded Future's 2025 Candiru domain set (independent attribution).
 *  - Skip IP addresses (cloud IPs are reassigned; a browser sensor sees hostnames),
 *    file hashes, the vulnerable-driver hash, and 2021-2022 historical sets.
 *  - Re-classify every row into AdTripwire's three classes explicitly below.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const input = positional[0] ?? "packages/indicators/upstream/zero-breach/adfection_iocs.txt";
const output = positional[1] ?? "packages/indicators/data/adfection-2026.json";
const withdrawalsPath = opt("withdrawals");
const strict = process.argv.includes("--strict");
const rawInput = readFileSync(input, "utf8");
const upstreamAsOf = /^#\s*as-of:\s*(\d{4}-\d{2}-\d{2})/m.exec(rawInput)?.[1];
if (!upstreamAsOf) throw new Error(`${input}: no "# as-of: YYYY-MM-DD" header`);

// Revoked indicator values from the withdrawals bundle (domain-name / url / hostname patterns).
const withdrawn = new Set();
if (withdrawalsPath) {
  const bundle = JSON.parse(readFileSync(withdrawalsPath, "utf8"));
  for (const o of bundle.objects ?? []) {
    if (o.type !== "indicator" || o.revoked !== true || typeof o.pattern !== "string") continue;
    for (const m of o.pattern.matchAll(/value\s*=\s*'([^']+)'/g)) withdrawn.add(m[1].toLowerCase());
  }
}

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
// CloudFront staging distributions were rotated within days (Confiant), so they are only
// treated as current until this date; later matches are reported as expired.
const CLOUDFRONT_STAGING_VALID_TO = "2026-12-31";
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

const rows = rawInput
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("\t"))
  .filter((c) => c.length === 4);

const out = [];
const skipped = {
  ip: 0,
  hash: 0,
  historicalSecondary: 0,
  vulnDriver: 0,
  withdrawn: 0,
  other: 0,
};
const unknownRows = [];

for (const [indicator, tier, confidence, source] of rows) {
  const value = indicator.toLowerCase();
  if (withdrawn.has(value)) {
    skipped.withdrawn++;
    continue;
  }
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
    unknownRows.push(`${value}\t${tier}\t${confidence}\t${source} (unknown source)`);
    continue;
  }

  let classification, role, conf, notes;
  // Optional end of the validity window (ISO date); only time-bounded infrastructure sets it.
  let validTo;
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
        "CloudFront distribution used for ?impid= / ?qq= iframe staging. Time-bounded: Confiant reports distributions were rotated within days; CloudFront names can be reassigned.";
      validTo = CLOUDFRONT_STAGING_VALID_TO;
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
    unknownRows.push(`${value}\t${tier}\t${confidence}\t${source} (unknown tier)`);
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
    // The indicator is considered valid from the date its source was published.
    validFrom: src.published,
    ...(validTo === undefined ? {} : { validTo }),
    enabled: true,
    role,
    notes,
  });
}

// Manually curated path-scoped indicators from the Citizen Lab report body (not in the
// Zero Breach list, which is hostname-only). Contextual leads: they show Discover-Tech
// cookie-sync or creative hosting on shared platforms, so the HOST alone must never match.
const MANUAL = [
  {
    indicator: "an.yandex.ru",
    indicatorType: "hostname_path",
    pathPattern: "/mapuid/discovertechis",
    source: SOURCES["citizenlab-adfection-2026"].name,
    sourceUrl: SOURCES["citizenlab-adfection-2026"].url,
    campaign: "adfection",
    classification: "contextual",
    confidence: "high",
    firstReported: "2026-10-15",
    lastReviewed: "2026-11-02",
    validFrom: "2026-10-15",
    enabled: true,
    role: "cookie-sync-partner",
    notes:
      "Yandex user-id sync endpoint dedicated to Discover-Tech ('discovertechis'). Contact means a Yandex-served ad slot synced the browser's id with Discover-Tech; this is exposure to the operator's audience pipeline, not targeting.",
  },
  {
    indicator: "cloud-images.s3.eu-west-1.amazonaws.com",
    indicatorType: "hostname_path",
    pathPattern: "/MyDSP_Beeswax/",
    source: SOURCES["citizenlab-adfection-2026"].name,
    sourceUrl: SOURCES["citizenlab-adfection-2026"].url,
    campaign: "adfection",
    classification: "contextual",
    confidence: "medium",
    firstReported: "2026-10-15",
    lastReviewed: "2026-11-02",
    validFrom: "2026-10-15",
    enabled: true,
    role: "creative-hosting",
    notes:
      "S3 bucket path used for MyDSP creatives served through Beeswax. The bucket host is shared infrastructure; only this path prefix is an indicator.",
  },
];
out.push(...MANUAL);

// Deterministic order and ids.
out.sort((a, b) => a.indicator.localeCompare(b.indicator));
const seen = new Set();
const dedup = out.filter((r) => (seen.has(r.indicator) ? false : (seen.add(r.indicator), true)));
dedup.forEach((r, i) => {
  r.id = `adf-${String(i + 1).padStart(4, "0")}`;
});
const ordered = dedup.map(({ id, ...rest }) => ({ id, ...rest }));

// Keep version/asOf when nothing changed; otherwise bump to today and the upstream as-of.
const previous = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : null;
const unchanged =
  previous !== null && JSON.stringify(previous.indicators) === JSON.stringify(ordered);
const today = new Date().toISOString().slice(0, 10);
const version = unchanged ? previous.meta.version : today.replace(/-/g, ".");
const asOf = unchanged ? previous.meta.asOf : upstreamAsOf;

const set = {
  meta: {
    id: "adfection-2026",
    name: "AdFection / Discover-Tech / Candiru infrastructure",
    version,
    asOf,
    license: "CC0-1.0 (indicator data via Zero Breach; facts from the cited reports)",
    synthetic: false,
    description:
      "Curated hostnames and domains documented by Citizen Lab and Confiant (2026-10-15) and Recorded Future (2025-08-05). IPs, hashes and 2021-2022 historical sets deliberately excluded.",
    sources: Object.values(SOURCES).concat([
      {
        name: "Zero Breach (interplains/zero-breach) curated IOC list, CC0 1.0",
        url: "https://github.com/interplains/zero-breach",
        published: upstreamAsOf,
      },
    ]),
  },
  indicators: ordered,
};
writeFileSync(output, JSON.stringify(set, null, 2) + "\n");
const byClass = {};
for (const r of ordered) byClass[r.classification] = (byClass[r.classification] ?? 0) + 1;
console.log(
  `wrote ${ordered.length} indicators to ${output} (version ${version}, asOf ${asOf}, ${unchanged ? "unchanged" : "CHANGED"})`,
  byClass,
  "skipped:",
  skipped,
);
if (unknownRows.length) {
  console.error(
    `rows skipped for an unknown source or tier (need a curation decision):\n${unknownRows.join("\n")}`,
  );
  if (strict) process.exit(3);
}
