# Benign-browsing evaluation — 2026-11-02

Protocol: `tests/fixtures/benign-browsing.md`. Production build (real indicator set only),
headless Firefox, 24 sites in batches of 6, 90 s per batch, default settings,
Enhanced Tracking Protection at its default. Script: `scripts/benign-eval.mjs`.

Extension ready lines observed: 5 of 4 batches.
Sensor activity (last stats line per batch, counts only): stats: observed=929 ingested=754 inspections=0 detections=0; stats: observed=420 ingested=507 inspections=0 detections=0; stats: observed=999 ingested=1430 inspections=0 detections=0; stats: observed=837 ingested=589 inspections=0 detections=0.

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
- 90 s per batch captures initial loads only. Repeated-exposure (F) cannot fire within one run.
- Sites were loaded concurrently in one window; tab-level correlation sees them as separate tabs.

## Analyst notes (added after the run)

- Build: Phase 2 production bundle (22 rules, PSL, validity windows, lineage correlation).
  Indicator set `adfection-2026` v2026.11.02 only; page sensor **off** (production default),
  so the `page.*` rules were not exercised in this run.
- The sensor was demonstrably active: the per-batch stats lines show 420–999 observed
  third-party or framed requests per batch (≈3,200 in total) and zero response inspections,
  i.e. none of the 24 sites contacted a documented indicator host or a `/getAd`-pattern path.
- Result: **zero detections at any severity**, including the informational
  `profiling.identifier_rich_request`. This is a lower bound on exposure (headless, no
  consent interaction, no scrolling), not evidence that these sites are free of invasive
  ad-tech. An interactive session following `tests/fixtures/benign-browsing.md` and a run
  with the page sensor enabled remain to be done.
- "5 of 4" ready lines: one batch logged ready twice, consistent with the event page being
  suspended and restarted; no events were lost according to the stats counters.
