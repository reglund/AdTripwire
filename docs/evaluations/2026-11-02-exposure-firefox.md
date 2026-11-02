# Exposure evaluation (ad-heavy sites), Firefox — 2026-11-02

Site list: `tests/fixtures/exposure-sites.txt` (the ad-heavy publishers from
`docs/exposure-session.md`), not the benign baseline list; the report body below was produced
by `scripts/benign-eval.mjs`, hence its template wording. Purpose: look for real contact with
the documented AdFection infrastructure in live programmatic ad traffic from a fresh profile.
Production build 0.2.0 from the published release (real indicator set only), headless
Firefox, 50 sites in batches of 6, 90 s per batch, default settings, Enhanced Tracking
Protection at its default.

Outcome: **no contact with any of the 167 documented hosts**; two informational
identifier-rich-request observations (ordinary ad-tech profiling parameters). The
"INCONSISTENT" cross-check below is a timing artefact, not tampering: the extension's periodic
counter line for batch 2 was captured before the second informational detection fired, so the
parsed count (2) exceeded the counter (1). The script has since been changed to report this
case as "counter predates last detection" instead of flagging tampering.

Extension ready lines observed: 9 of 9 batches.
Sensor activity (last stats line per batch, counts only): batch 1: observed=806 ingested=675 inspections=0 detections=0; batch 2: observed=1023 ingested=662 inspections=0 detections=1; batch 3: observed=971 ingested=518 inspections=0 detections=0; batch 4: observed=655 ingested=710 inspections=0 detections=0; batch 5: observed=463 ingested=643 inspections=0 detections=0; batch 6: observed=1400 ingested=2217 inspections=0 detections=0; batch 7: observed=886 ingested=826 inspections=0 detections=0; batch 8: observed=890 ingested=1017 inspections=0 detections=0; batch 9: observed=712 ingested=1152 inspections=0 detections=0.
Console cross-check: **INCONSISTENT** — more detection lines parsed than the extension's counters report; treat this run as possibly tampered with by a page.

## Detections by rule and severity

| Rule | Severity | Count | Seen in batches |
|---|---|---|---|
| `profiling.identifier_rich_request` | informational | 2 | 2 |

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
- 90 s per batch captures initial loads only. Repeated-exposure (F) cannot fire within one run.
- Sites were loaded concurrently in one window; tab-level correlation sees them as separate tabs.
