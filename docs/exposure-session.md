# Finding real exposure: interactive session protocol

Goal: let AdTripwire observe ordinary browsing with many programmatic ad impressions and
record whether the browser contacts infrastructure documented in the AdFection reports.

## What this can and cannot tell you

- A **surveillance** or **contextual** match (NOAS servers, cookie-sync hosts, the Yandex
  `mapuid/discovertechis` sync, Discover-Tech apex domains) means an ad slot you loaded was
  connected to the operator's pipeline. The reports describe this at the scale of billions
  of impressions; it is **exposure**, not targeting.
- A **malicious** match (validator, C2, Candiru-attributed domains) or a correlated
  **AdFection chain** is a high-priority lead that should be investigated with a specialist
  (e.g. Access Now's helpline, Citizen Lab). It is still not proof of infection.
- **No detections prove nothing.** Selection happens server-side per device and the
  campaign's CloudFront staging hosts rotate. Only 2 of 305 validator domains are public.
- For _past_ exposure (before installing AdTripwire), run Zero Breach
  (https://github.com/interplains/zero-breach), which scans browser history and caches
  offline for the same indicators. The two tools are complementary.

## Setup

1. Use the **Firefox build** (response inspection and tracking-protection flags are
   available there; Chromium sees less). `pnpm build`, then load it or use the signed zip.
2. Settings → enable the **page sensor** (structural signals from ad frames).
3. Keep Enhanced Tracking Protection at **Standard** (Strict blocks many ad slots and
   therefore hides exposure). Do not use an ad blocker in this profile.
4. Prefer a normal (non-private) window; private windows are excluded by default.
5. Optional: a second run on a phone-like viewport (Responsive Design Mode, mobile UA)
   because the campaign targeted mobile identifiers heavily.

## Automated variant

`pnpm exposure:build && pnpm exposure:firefox` (or `exposure:chromium`, `--mobile`) performs
this session automatically with a persistent profile: consent accepted, scrolling, one
article per site, 75 s dwell, report with auction evidence per site. Run it daily for at
least three days to let the repeated-exposure rule fire; `sh scripts/install-exposure-timer.sh`
installs a user-level systemd timer, `--remove` uninstalls it. Each day (11:30 ± 30 min) it
rebuilds the evaluation bundles, then runs `scripts/exposure-daily.sh` (also `pnpm exposure:daily`
by hand): eight variants, two at a time (60 s per site, persistent profiles, detections kept for
a year, page sensor on): desktop Firefox, desktop Chromium, Chromium with iPhone 15 and with
Pixel 5 (Android) emulation, and Chromium desktop and Pixel 5 on each of two regional lists
(`norway.txt`, `mena-africa.txt`), and finally `pnpm exposure:trend`
and the observatory build. `ADTRIPWIRE_EXPOSURE_PARALLEL` (1-4, default 2; one headless run uses
about 1.5 GB), `ADTRIPWIRE_EXPOSURE_SECONDS` and `ADTRIPWIRE_EXPOSURE_DIR` override the defaults;
the whole run takes about 4-5 h. Each variant writes its console output to
`~/.cache/adtripwire-exposure/live/<date>-<variant>.log` and the script prints one
`done <variant> exit=<n>` line per variant. Everything is written outside the
repository: JSON per run in `~/.cache/adtripwire-exposure/`, per-run reports in its
`reports/`, and the cumulative view in `trend.md` (documented hosts with first/last seen,
distinct days, variants and sites; runs by day and severity). It cannot stand in for your own
profile (logins, history, your consent choices), so keep the manual session below as the
reference.

The results can also be published as a static site, the observatory: a page and full per-run
data per day and variant, with a one-command way to reproduce any day. See
[observatory.md](observatory.md).

To run the automated variant daily from your own machine and contribute the rows to the observatory, see `docs/rig-setup.md`.

## Session

- Visit the sites in `tests/fixtures/exposure-sites.txt` (or your own daily sites).
- On each: accept the consent dialog (consent _enables_ the programmatic auctions that
  carry the documented ads), stay 60–90 s, scroll to the bottom, open one article, return.
- Aim for 30–60 minutes total. Repeat on different days; the repeated-exposure rule
  (category F) needs three distinct days.

## Reading the result

- Dashboard → Detections. Anything **elevated** or **high priority**: open the detail view,
  read "What was observed", the evidence and the benign explanations, then **export**
  (default profile) before doing anything else.
- `known_infra.surveillance_contact` on tracking hosts (cookie-sync.xyz, tracookiepixel.xyz)
  or the Yandex sync path: expected at some rate for anyone seeing programmatic ads.
- NOAS hosts (`noas.*`, `ppv2.*`) with a **non-empty JavaScript response** is the branch the
  reports associate with selected devices: export immediately and seek expert help.
- Do not visit, probe or "test" the indicator hosts yourself. Passive observation only.

## Recording

Append each session to `docs/evaluations/` using the benign-browsing template, noting
date, duration, site list, ETP mode and the detections by rule. These sessions are
**exposure measurements**, kept separate from the false-positive studies.
