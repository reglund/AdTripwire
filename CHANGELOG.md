# Changelog

All notable changes to AdTripwire. The format follows Keep a Changelog; versions follow
semantic versioning for the extension packages.

## [Unreleased]

### Added

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

### Changed

- `ad_delivery.redirect_chain` is informational by default and reported once per tab; it
  escalates to suspicious only when a hop reaches documented infrastructure.

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
