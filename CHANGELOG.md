# Changelog

All notable changes to AdTripwire. The format follows Keep a Changelog; versions follow
semantic versioning for the extension packages.

## [0.2.0] — 2026-11-02

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
