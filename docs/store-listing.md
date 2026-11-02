# Store listing and permission explanations

Draft texts for addons.mozilla.org (AMO) and the Chrome Web Store. Keep the language
conservative: AdTripwire observes and explains; it does not protect, block or certify.

## Short description (≤ 132 chars)

Detect the threat behind the ad. Passive, local-only detection of advertising-based
surveillance infrastructure. Evidence, not blocking.

## Long description

AdTripwire is an open-source security sensor for your browser. It watches advertising-related
network activity for observable indicators of surveillance and spyware delivery documented
by security researchers (the AdFection technique reported by The Citizen Lab and Confiant in
October 2026), and it preserves sanitized evidence you can review or hand to an expert.

What it does

- Matches contacted hosts against a curated, sourced indicator set.
- Recognises documented ad-selection ("NOAS/getAd") request patterns and, on Firefox,
  inspects narrowly selected script responses for documented techniques, byte-for-byte
  pass-through.
- Correlates events over time within a frame lineage and explains every detection: what was
  observed, why it matters, which rule fired, what the evidence is, what it could not see,
  and what benign explanations exist.
- Exports redacted JSON evidence for incident response.

What it does not do

- It does not block, modify or redirect traffic.
- It makes no network requests of its own: no telemetry, no accounts, no cloud.
- It never stores cookies, tokens, page content, full URLs with query values, or your
  browsing history.
- It cannot tell you that your device is free of spyware. Absence of detection is not
  evidence of absence; confirmed compromise requires independent forensic analysis.

Who it is for: people who may be targeted, journalists, NGOs, researchers and security
teams who want observable evidence rather than reassurance.

## Permission justifications

| Permission                                       | Firefox | Chromium | Why                                                                                                                                  |
| ------------------------------------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Access your data for all websites (`<all_urls>`) | yes     | yes      | Ads can appear on any site; the sensor needs to see requests everywhere. Nothing is observed until granted; revoke at any time.      |
| `webRequest`                                     | yes     | yes      | Observe request metadata (hosts, types, status).                                                                                     |
| `webRequestBlocking`, `webRequestFilterResponse` | yes     | no       | Firefox requires these to create a pass-through `StreamFilter` for response inspection. Nothing is blocked or modified.              |
| `webNavigation`                                  | yes     | yes      | Frame ancestry for the opt-in page sensor (Firefox) and for all requests (Chromium, which does not expose ancestry in `webRequest`). |
| `tabs`                                           | no      | yes      | Chromium request details carry no private-window flag; the tab's incognito state is read to exclude private windows.                 |
| `scripting`                                      | yes     | yes      | Register or unregister the opt-in page sensor content script at runtime. Nothing is injected unless enabled in Settings.             |
| `storage`, `unlimitedStorage`                    | yes     | yes      | Local persistence of detections and settings.                                                                                        |
| `alarms`                                         | yes     | yes      | Periodic retention sweeps on an event page / service worker.                                                                         |

## Data collection disclosure (Firefox `data_collection_permissions`: none)

The extension collects no data for the developer. All processing is local. Users can export
their own detections as redacted JSON and delete all data in Settings.

## Chromium build note

Chromium cannot inspect response bodies and does not expose tracking classification; the
dashboard lists the affected rules as "not evaluable in this browser".
