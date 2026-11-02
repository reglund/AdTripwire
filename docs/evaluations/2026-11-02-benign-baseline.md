# Benign-browsing evaluation — 2026-11-02

Protocol: `tests/fixtures/benign-browsing.md`. Production build (real indicator set only),
headless Firefox, 24 sites in batches of 6, 75 s per batch, default settings,
Enhanced Tracking Protection at its default. Script: `scripts/benign-eval.mjs`.

Extension ready lines observed: 4 of 4 batches.
Sensor activity (last stats line per batch, counts only): no stats lines (build predates stats logging).

## Detections by rule and severity

| Rule | Severity | Count | Seen in batches |
|---|---|---|---|
| (none) | | | |

## Verdict

No elevated or high-priority detections during benign browsing. Informational and suspicious detections describe exposure to ad-tech behaviour and are expected at some rate; they are listed for tuning, not as findings.

## Triage notes

- Nothing to triage at elevated or above.

## Raw detection lines (sanitized by the extension; hostnames only)

- none

## Limitations of this run

- Headless Firefox in a fresh profile: no consent-dialog interaction, no scrolling, no clicks; some ad slots never render.
- 75 s per batch captures initial loads only. Repeated-exposure (F) cannot fire within one run.
- Sites were loaded concurrently in one window; tab-level correlation sees them as separate tabs.

## Analyst notes (added after the run)

Phase 1 build (19 rules). Zero detections on the same 24 sites. This build predates the
periodic stats line, so sensor activity could not be confirmed from the log; the Phase 2 run
(`2026-11-02-benign-phase2.md`) confirms the sensor observes ~3,200 requests over the same
list. Two earlier attempts of this run were invalid (snap Firefox could not read the build
from `/tmp`; a lingering instance locked the profile) and were discarded.
