# Interactive exposure run, chromium (Pixel 5 emulation) — 2026-11-02

Script: `scripts/exposure-run.mjs`. Evaluation build 0.2.0 (production indicator set, adfection-2026 2026.11.02), headless chromium, persistent profile `~/snap/chromium/common/adtripwire-exposure-profile-pixel-5`, 75 s per site, consent accepted where a dialog was recognised, scrolled, one article opened. Capabilities: request_metadata, redirect_chain, response_headers, response_size, frame_ancestry.

## Notes on this run (added after review)

Two contacts with infrastructure documented in The Citizen Lab's AdFection report, both
*surveillance* class (ad-platform infrastructure), both exposure rather than targeting:

- **goal.com, 19:42:58 UTC.** In a depth-3 ad frame served from `match.prod.bidr.io`
  (Beeswax, a demand-side platform), an image request went to `tracookiepixel.xyz/log` with
  parameter names `bdsp_uid`, `c_uid`, `cust_id`, `gdpr`, `gdpr_pd`, `key` (values not stored).
  Indicator adf-0161: Discover-Tech cookie-sync / impression tracking, high confidence. This is
  a user-ID match between the Beeswax DSP and Discover-Tech's tracking endpoint on a major
  Western sports site; Citizen Lab describes MyDSP creatives being served through Beeswax.
- **lenta.ru, 19:59:45 UTC.** A Yandex ad frame (`yastatic.net`) requested
  `events.myweb3id.io/cookie-sync/yandex` with a `userid` parameter: the same path observed on
  ria.ru with desktop Chromium earlier the same day (adf-0081, adf-0116).

No NOAS request, selective response, validator or C2 contact followed either contact. Neither
appeared in the desktop or iPhone runs of the same sites; the Android profile drew different
auctions.

## Summary

- Sites: 50; loaded 50; consent clicked on 26 (no click means no dialog was recognised, or consent was already stored in this persistent profile); article opened on 45.
- Requests observed by the sensor: 37662. Third-party registrable domains per site, counted by this script from the page's own requests: median 46; 6 loaded site(s) contacted fewer than 10, which suggests few or no ad auctions ran there.
- Detections: 2 (2 suspicious). Contact with documented infrastructure (rules known_infra.*): 2.
- Cumulative in this profile: 2 detections, 2 known-infrastructure observations, 0 high priority.

## Per site

| # | Site | Loaded | Consent clicked | Article | Requests (sensor) | 3rd-party domains (page) | Detections |
|---:|---|:-:|---|:-:|---:|---:|---|
| 1 | www.vg.no | yes | selector button.sp_choice_type_11 | yes | 572 | 37 | — |
| 2 | www.dagbladet.no | yes | selector button.sp_choice_type_11 | yes | 966 | 84 | — |
| 3 | www.nettavisen.no | yes | selector button.sp_choice_type_11 | yes | 809 | 69 | — |
| 4 | www.tv2.no | yes | selector button.sp_choice_type_11 | yes | 439 | 30 | — |
| 5 | www.finn.no | yes | selector button.sp_choice_type_11 | yes | 408 | 25 | — |
| 6 | www.seher.no | yes | selector button.sp_choice_type_11 | yes | 717 | 65 | — |
| 7 | www.kk.no | yes | selector button.sp_choice_type_11 | yes | 842 | 98 | — |
| 8 | www.dinside.no | yes | — | no | 431 | 42 | — |
| 9 | www.klikk.no | yes | selector button.sp_choice_type_11 | yes | 631 | 59 | — |
| 10 | www.dailymail.co.uk | yes | text "Accept" | no | 741 | 94 | — |
| 11 | www.thesun.co.uk | yes | selector button.sp_choice_type_11 | yes | 1678 | 149 | — |
| 12 | www.mirror.co.uk | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 3166 | 232 | — |
| 13 | nypost.com | yes | selector #onetrust-accept-btn-handler | yes | 1170 | 136 | — |
| 14 | www.foxnews.com | yes | text "OK" | yes | 861 | 80 | — |
| 15 | www.independent.co.uk | yes | — | yes | 1012 | 105 | — |
| 16 | www.express.co.uk | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 2305 | 174 | — |
| 17 | www.flashscore.com | yes | selector #onetrust-accept-btn-handler | yes | 1490 | 74 | — |
| 18 | www.sofascore.com | yes | — | no | 11 | 1 | — |
| 19 | www.livescore.com | yes | selector #onetrust-accept-btn-handler | yes | 1204 | 114 | — |
| 20 | www.goal.com | yes | selector button.sp_choice_type_11 | yes | 1237 | 87 | known_infra.surveillance_contact [suspicious] |
| 21 | www.espn.com | yes | selector #onetrust-accept-btn-handler | yes | 437 | 30 | — |
| 22 | www.azlyrics.com | yes | selector #CybotCookiebotDialogBodyButtonAccept | yes | 1414 | 126 | — |
| 23 | genius.com | yes | selector #onetrust-accept-btn-handler | yes | 1807 | 156 | — |
| 24 | www.speedtest.net | yes | selector #onetrust-accept-btn-handler | yes | 336 | 74 | — |
| 25 | www.ilovepdf.com | yes | — | yes | 52 | 4 | — |
| 26 | convertio.co | yes | — | no | 25 | 5 | — |
| 27 | www.online-convert.com | yes | — | yes | 166 | 7 | — |
| 28 | www.timeanddate.com | yes | — | yes | 95 | 8 | — |
| 29 | poki.com | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 456 | 11 | — |
| 30 | www.crazygames.com | yes | selector button.sp_choice_type_11 | yes | 632 | 46 | — |
| 31 | www.boredpanda.com | yes | selector button#didomi-notice-agree-button | yes | 1213 | 146 | — |
| 32 | 9gag.com | yes | — | no | 92 | 3 | — |
| 33 | lenta.ru | yes | — | yes | 1737 | 95 | known_infra.surveillance_contact [suspicious] |
| 34 | ria.ru | yes | — | yes | 526 | 21 | — |
| 35 | www.gazeta.ru | yes | — | yes | 698 | 27 | — |
| 36 | www.kp.ru | yes | — | yes | 322 | 54 | — |
| 37 | www.sports.ru | yes | — | yes | 433 | 15 | — |
| 38 | www.blic.rs | yes | — | yes | 271 | 32 | — |
| 39 | www.kurir.rs | yes | — | yes | 1532 | 118 | — |
| 40 | www.b92.net | yes | selector button#didomi-notice-agree-button | yes | 996 | 83 | — |
| 41 | www.youm7.com | yes | — | yes | 346 | 35 | — |
| 42 | www.masrawy.com | yes | — | yes | 397 | 43 | — |
| 43 | www.aljazeera.net | yes | selector #onetrust-accept-btn-handler | yes | 327 | 23 | — |
| 44 | www.alarabiya.net | yes | — | yes | 174 | 15 | — |
| 45 | www.hurriyet.com.tr | yes | — | yes | 339 | 31 | — |
| 46 | www.sozcu.com.tr | yes | — | yes | 435 | 29 | — |
| 47 | punchng.com | yes | — | yes | 284 | 21 | — |
| 48 | www.vanguardngr.com | yes | — | yes | 377 | 25 | — |
| 49 | www.ndtv.com | yes | — | yes | 505 | 60 | — |
| 50 | www.indiatimes.com | yes | — | yes | 548 | 45 | — |

## Detections

| Rule | Severity | Site | Subject hostnames (documented infrastructure, elevated and above) |
|---|---|---|---|
| `known_infra.surveillance_contact` | suspicious | www.goal.com | tracookiepixel.xyz |
| `known_infra.surveillance_contact` | suspicious | lenta.ru | events.myweb3id.io |

## Reading this

- Results come from the extension's own UI protocol (status and detection list), not from parsed console output, so a page cannot forge them.
- No detection of a documented host means that host did not appear in the ad auctions this profile took part in during this run; it says nothing about other profiles, networks, devices or days. The repeated-exposure rule needs three distinct days in the same profile.
- Consent recognition is heuristic; sites where consent was not clicked ran fewer or no auctions.
