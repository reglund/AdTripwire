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
