# Changelog

All notable changes to AdTripwire. The format follows Keep a Changelog; versions follow
semantic versioning for the extension packages.

## [Unreleased]

### Added

- **Observatory "How each finding flowed"**: each finding drawn as a chain (site → frame that
  sent the request → documented host and its stage in the AdFection chain → how the request
  ended → how to read it), under an overview of the five stages (ad auction, tracking and ID
  sync, ad selection, delivery and staging, spyware infrastructure) with the number of findings
  per stage. Identical chains on several days are drawn once; at most 40, newest first. Reading
  texts are conservative; "worth a closer look" marks answered ad-selection and delivery
  contacts and any spyware-infrastructure contact (not delivery contacts whose outcome was not
  recorded, as in runs before 2026-11-08) and is a reading aid, not a finding about a device. Static
  HTML and CSS, light and dark, vertical on phones. Index field `flows[]`.
- **Exposure harness: the frame that sent each request to a documented host**
  (`documentedOutcomes[].via[]`, at most 5 hostnames, and `fromTop` for the page's own
  document). The frame is looked up when the request ends, because Firefox (WebDriver BiDi) can
  report a new frame's address only after its first requests; an about:blank ad frame is named
  by its nearest ancestor with an address. Hostnames only. Verified in Chromium and Firefox
  against a local page (5 runs each).

- **How requests to documented hosts ended**: the exposure harness records, from the browser's
  own network log, the HTTP status, declared size, redirect target domain or network error of
  every request to a documented (surveillance or malicious, current) host, per site
  (`documentedOutcomes`), and the observatory lists them. This separates "the ad stack still
  points at this host" from "this host still answers". Hostnames, status codes, sizes and error
  codes only. First smoke run (2026-11-08, ria.ru): Yandex's ad frame still requested
  `events.myweb3id.io`, which no longer resolves (`net::ERR_NAME_NOT_RESOLVED`).

### Fixed

- **Observatory undercounted sites that carried a documented host**: within one run the engine
  merges later contacts with the same host into the first detection (deduplication), so only the
  first site showed. The harness now records these as `repeatContacts` per site (from
  occurrenceCount rises), and the observatory lists them as "repeat contact in the same run";
  for older runs they are reconstructed from seen-alongside anchors (2026-11-07: 5 contacts
  instead of 2). Severity columns are unchanged.

### Changed

- **Observatory "Seen alongside": leading per-visit ID labels (long numbers, long hex, UUIDs)
  are collapsed to `*`, so `5654…120.cm.a.mts.ru` counts as `*.cm.a.mts.ru` instead of one
  single-day row per visit. The registrable domain is never collapsed; rig data is unchanged.

## [0.5.0] — 2026-11-07

### Added

- **Norwegian detection and rule text**: every rule writes bokmål next to the English
  (`Detection.nb`, `RuleDefinition.nb`), with the same hostnames and counts; the dashboard,
  popup and Rules view show it when the language is Norwegian, and older detections say they
  are shown in English. Exports stay English (`nb` is stripped). Terminology reviewed by a
  native reader (Gate 11). A Norwegian verdict-word guard runs over all rule text, the hand-off
  text and the UI strings. `pnpm nb:review` writes `docs/phase-11-nb-review.md`.
- **Share with a specialist**: a sheet before the hand-off export shows the redaction profile,
  what is included, what the recipient can and cannot conclude, an optional note (never
  stored) and where to send it (Access Now, your IT security/CERT, Citizen Lab). The package
  carries a cover note (English, optionally Norwegian), also downloadable as `.md`.

### Changed

- Hand-off package under the strict profile: the embedded STIX part is pseudonymised with the
  same salt as the evidence part, and analyst notes are left out.
- Assist screen: more Norwegian verdict sentences are removed (smittet, rammet, fri for
  spionvare, uten fare, filler words with æ/ø/å, "ikke bare infisert"); a negated verb that is
  not about knowing ("vil ikke skjule at …") no longer counts as a caveat.

## [0.4.0] — 2026-11-07

### Added

- **Knowledge-sector variant**: `firefox-norway-sector` in the daily run, over
  `tests/fixtures/norway-sector.txt` (Norwegian trade media with ad auctions plus a no-auction
  control group).
- **Seen alongside**: a dashboard tab listing hostnames that appeared in the same ad frame as
  a host from the indicator set (surveillance or malicious, currently valid). Ranked by the
  share of days a host was seen alongside a documented host out of the days its domain was
  seen at all. Not a detection and never a severity; the page's own site is never recorded
  (fail closed without a known top document; anchors close on navigation). Included in the
  hand-off package (omitted under the strict profile) and in the STIX export as
  `observed-data`, never as `indicator`. The exposure harness records per-site deltas
  (`alongside`, `thirdPartyDomainsList`, `alongsideAnchors`) and the observatory page gets a
  "Seen alongside documented hosts" section. Plan: `docs/seen-alongside-plan.md`.

- **If you are concerned**: the Exposure view and the README list the steps the Citizen Lab
  report recommends to people who may be targeted (advertising ID, ad blocking), with a link
  to Security Planner, and say that AdTripwire itself only observes.
- **Docker rig**: `docker/` (Dockerfile with Debian Chromium and Firefox from Mozilla's apt
  repository, entrypoint with a `smoke` mode, compose file, host systemd timer and installer) and
  `docs/rig-docker.md` for moving the daily exposure run to a home server. `exposure-run.mjs`
  reads `ADTRIPWIRE_CHROME_ARGS` (container-only Chromium flags such as `--no-sandbox`).

### Fixed

- README: Chrome and Chromium grant site access at install (no prompt); only Firefox asks in the
  popup.
- Seen alongside: navigations seen before the stored snapshot is restored at startup still close
  the backward scan (the restored tracker inherits the per-tab navigation times).

## [0.3.0] — 2026-11-06

### Added

- **AMO submission guide**: `docs/amo-submission.md` (what to upload, reproducible source-review
  instructions verified in clean clones, listing text, reviewer notes, privacy text, checklist).
- **Check this yourself**: `docs/verify-yourself.md` (CSP, permissions, a grep for network code,
  zero runtime dependencies, stored data, reproducible build, and a plain statement that the
  code is largely AI-written) and a Settings card that shows the manifest the browser loaded
  (version, CSP, permissions) with a link to it. No network request. Norwegian strings included.
- **Observatory in the Exposure view**: each documented host now carries a note from a snapshot
  of the public observatory bundled at build time (on how many measured days generic automated
  profiles saw it, last seen, on which sites), or a statement that it was not seen, which says
  nothing either way. No network request; refresh with `pnpm observatory:snapshot` before a
  release. Norwegian strings included.
- **Observatory notifications**: the primary rig's daily run ends with
  `scripts/observatory-notify.mjs`, which sends a plain-text digest (new documented hosts, new
  sites carrying a known host, new elevated or correlated detections, a one-line summary)
  through `ADTRIPWIRE_NOTIFY_CMD` (message on stdin), logs it and keeps a state file so only
  changes are reported. See `docs/observatory.md`.
- **Morning line and calendar**: the popup and the Exposure view say what yesterday looked like
  ("Yesterday: N page(s), N contact(s) with documented infrastructure"), compare yesterday's
  third-party domains per page with the 30-day normal, and show a 53-week calendar (one button
  per day, keyboard-navigable, with a plain list of days with contacts). Built from per-day
  counters kept on the device for 400 days; pages are counted, never named. Norwegian strings
  included.
- **Exposure view**: every documented host this browser contacted, told as a short story —
  site → ad frame → documented host — with what the source says the host is, what that
  means, first/last seen, days, path and parameter names, and a copy-ready sanitized note
  for researchers.
- **Toolbar badge**: the extension icon shows the number of recent contacts with documented
  infrastructure (amber for ad-platform hosts, red for spyware-delivery hosts, "!" for strong
  signals); the tooltip says what it counts.
- **Popup headline**: the answer first — "No documented infrastructure seen" with the traffic
  watched, or what was contacted with a button straight to the story.
- Signed indicator bundles, upstream refresh workflow and stale-indicator notice; interactive
  exposure runner with consent, device emulation and long-term trend reports.
- **Observatory**: the daily exposure run now also builds a static site (documented hosts over
  time, sites, browsers and devices side by side, full per-run data), optionally published to a
  git branch by `scripts/observatory-publish.sh` (off unless `ADTRIPWIRE_OBSERVATORY_REMOTE` is
  set), and `pnpm observatory:reproduce` re-runs one published day and compares it within a
  stated tolerance. See `docs/observatory.md`.
- **Many rigs**: the observatory page and data are built over several measurement machines
  (`--rigs=<dir>`, `--rig=<name>`): a Rigs table with self-declared country and network, a rig
  column in the signal, host and site tables, files named `<date>-<rig>-<slug>`, `rigs[]` in
  `index.json`, and `observatory:reproduce --rig`. Onboarding: `docs/rig-setup.md`.
- **Daily run**: the logic moved from the systemd unit to `scripts/exposure-daily.sh`
  (`pnpm exposure:daily`); eight variants run two at a time (`ADTRIPWIRE_EXPOSURE_PARALLEL`),
  with per-variant logs and two new regional site lists (Norway, Middle East and Africa).

### Fixed

- **Evidence export button**: the dashboard saved the background's `{ filename, json }` wrapper
  with the export as an escaped string; it now saves the evidence export itself.
- **Exposure harness on Firefox 159**: the snap update of 2026-11-05 moved WebDriver BiDi's
  system-access switch from the `-remote-allow-system-access` flag to the
  `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` environment variable, so the harness could no longer reach
  the extension's dashboard; the run script now sets both.

## [0.2.0] — 2026-11-02

Released: https://github.com/reglund/AdTripwire/releases/tag/v0.2.0

First release candidate after Phases 1–6 of the roadmap.

### Added

- Firefox MV3 sensor with pass-through response inspection; Chromium build with reduced,
  declared capabilities (Phase 3).
- 22 explainable detection rules (categories A–F plus page signals), bounded correlation
  window, dedup with severity escalation, frame-lineage correlation (Phases 1–2).
- Curated indicator set (167 entries, CC0 data from Zero Breach / Citizen Lab) with validity
  windows and a hardened validator; optional opt-in page sensor (Phase 2).
- Research integration: STIX 2.1 export/import, ECS NDJSON for SIEMs, Zeek/Suricata feeds,
  analyst notes, timeline, hand-off package (Phase 4).
- Related-activity grouping, timeline narrative, suggested investigative actions; optional
  `--assist` build with loopback-only local-model explanations behind guardrails (Phase 5).
- Signed indicator bundles verified offline (Ed25519, pinned key), with diff preview and
  rollback; maintainer signing tool; reproducible release packaging, SBOM and `SHA256SUMS`
  (Phase 6).

### Security

- Independent reviews after Phases 1, 2, 4 and 5 with all findings fixed; records in
  `docs/threat-model.md`.

### Known limitations

- See `docs/limitations.md`. Absence of detection is never evidence of absence.
