# Exposure evaluation (ad-heavy sites), Chromium — 2026-11-02

Site list: `tests/fixtures/exposure-sites.txt` (the ad-heavy publishers from
`docs/exposure-session.md`), not the benign baseline list; the report body below was produced
by `scripts/benign-eval.mjs`, hence its template wording. Production build 0.2.0 from the
published release (real indicator set only), headless Chromium 156, one site per batch (headless
Chrome accepts a single start URL), 45 s per site, fresh profile per site.

Outcome: **no contact with any of the 167 documented hosts** and no detections at all on
Chromium, which sees request metadata only (no response bodies, no tracking classification).
The sensor's periodic counter line was not captured on Chromium in this run, so request
volume per site is not shown here; the extension's ready line was captured for every site.

Extension ready lines observed: 50 of 50 batches.
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
- 45 s per batch captures initial loads only. Repeated-exposure (F) cannot fire within one run.
- Sites were loaded concurrently in one window; tab-level correlation sees them as separate tabs.
