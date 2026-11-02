# Benign-browsing evaluation — 2026-11-02

Protocol: `tests/fixtures/benign-browsing.md`. Production build (real indicator set only),
headless Firefox, 24 sites in batches of 6, 90 s per batch, default settings,
Enhanced Tracking Protection at its default. Script: `scripts/benign-eval.mjs`.

Extension ready lines observed: 4 of 4 batches.
Sensor activity (last stats line per batch, counts only): stats: observed=868 ingested=747 inspections=0 detections=2; stats: observed=420 ingested=514 inspections=0 detections=2; stats: observed=1175 ingested=1850 inspections=0 detections=15; stats: observed=868 ingested=634 inspections=0 detections=3.

## Detections by rule and severity

| Rule | Severity | Count | Seen in batches |
|---|---|---|---|
| `page.late_third_party_script` | informational | 16 | 4 |
| `page.sdk_ready_message` | informational | 5 | 2 |
| `page.hidden_iframe_after_load` | suspicious | 1 | 1 |

## Verdict

No elevated or high-priority detections during benign browsing. Informational and suspicious detections describe exposure to ad-tech behaviour and are expected at some rate; they are listed for tuning, not as findings.

## Triage notes

- Nothing to triage at elevated or above.

## Raw detection lines (sanitized by the extension; hostnames only)

- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.sdk_ready_message [informational] A frame on accounts.google.com received a cross-origin message with a typed object payload.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.sdk_ready_message [informational] A frame on accounts.google.com received a cross-origin message with a typed object payload.
- [AdTripwire] detection page.sdk_ready_message [informational] A frame on i.liadm.com received a cross-origin message with a typed object payload.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.sdk_ready_message [informational] A frame on aax-eu.amazon-adsystem.com received a cross-origin message with a typed object payload.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.sdk_ready_message [informational] A frame on aim-tag.hcn.health received a cross-origin message with a typed object payload.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.late_third_party_script [informational] A third-party script was inserted after load.
- [AdTripwire] detection page.hidden_iframe_after_load [suspicious] A hidden cross-origin iframe was inserted after load.

## Limitations of this run

- Headless Firefox in a fresh profile: no consent-dialog interaction, no scrolling, no clicks; some ad slots never render.
- 90 s per batch captures initial loads only. Repeated-exposure (F) cannot fire within one run.
- Sites were loaded concurrently in one window; tab-level correlation sees them as separate tabs.

## Analyst notes (added after the run)

- Build: Phase 2 DEV bundle (page sensor enabled by default in DEV; the synthetic `.test`
  indicator set is also loaded but cannot match real hosts). Same 24 sites as the other runs.
- The page sensor was active in all batches: 22 detections, none above `suspicious`.
- `page.late_third_party_script` (16×, informational) and the generic typed-postMessage
  variant of `page.sdk_ready_message` (5×, informational) are **routine ad-tech behaviour**
  (tag loaders, consent frameworks, login/ad frames exchanging typed messages). Decision:
  these signals stay in the correlation window as corroboration but no longer produce
  stand-alone detections; `page.sdk_ready_message` fires only on the documented
  `analytics_sdk_ready` type. Implemented in the follow-up engine change.
- `page.hidden_iframe_after_load` (1×, suspicious/low, no NOAS anchor) is an acceptable
  rate for a "needs context" signal; it stays.
- Hostnames in summaries (e.g. `accounts.google.com`, `aax-eu.amazon-adsystem.com`) are
  sanitized frame hosts and part of the detection by design; no URLs or payloads were
  recorded.
