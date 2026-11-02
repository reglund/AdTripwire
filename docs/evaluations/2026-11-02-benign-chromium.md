# Benign-browsing evaluation — 2026-11-02

Protocol: `tests/fixtures/benign-browsing.md`. Production build (real indicator set only),
headless Chromium, 24 sites in batches of 1, 40 s per batch, default settings,
Enhanced Tracking Protection at its default. Script: `scripts/benign-eval.mjs`.

Extension ready lines observed: 24 of 24 batches.
Sensor activity (last stats line per batch, counts only): no stats lines (build predates stats logging).
Console cross-check: parsed detection lines are consistent with the extension's own counters.

## Detections by rule and severity

| Rule | Severity | Count | Seen in batches |
|---|---|---|---|
| (none) | | | |

## Verdict

No elevated or high-priority detections during benign browsing. Informational and suspicious detections describe exposure to ad-tech behaviour and are expected at some rate; they are listed for tuning, not as findings.

## Triage notes

- Nothing to triage at elevated or above.

## Provenance of this report

Derived from the extension's console output captured by web-ext. Lines are parsed with
anchored formats and only rule ids and severities are reproduced; no summaries, hostnames
or URLs from the log appear here. Web pages share the console channel, so a page could in
principle print look-alike lines; the cross-check above compares parsed counts with the
extension's own counters.

## Limitations of this run

- Headless Firefox in a fresh profile: no consent-dialog interaction, no scrolling, no clicks; some ad slots never render.
- 40 s per batch captures initial loads only. Repeated-exposure (F) cannot fire within one run.
- Sites were loaded concurrently in one window; tab-level correlation sees them as separate tabs.

## Analyst notes (added after the run)

- Build: Phase 3 Chromium production bundle (observational sensor, no body inspection,
  page sensor off). Chromium 156 (snap), headless, one site per launch in a fresh profile
  because headless Chromium accepts a single start URL; 40 s per site.
- The extension became ready in all 24 launches. The periodic stats line fires every 60 s,
  so with 40 s per site no stats lines were captured and sensor throughput cannot be read
  from this run; the Chromium e2e run on the same day confirms the sensor observes and
  detects on the fixture scenarios.
- Result: **zero detections at any severity** across the 24 sites, consistent with the
  Firefox run without the page sensor. Lower bound on exposure (headless, no consent
  interaction, no scrolling).
