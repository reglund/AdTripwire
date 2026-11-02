# Interactive exposure run, chromium — 2026-11-02

Script: `scripts/exposure-run.mjs`. Evaluation build 0.2.0 (production indicator set, adfection-2026 2026.11.02), headless chromium, persistent profile `~/snap/chromium/common/adtripwire-exposure-profile`, 75 s per site, consent accepted where a dialog was recognised, scrolled, one article opened. Capabilities: request_metadata, redirect_chain, response_headers, response_size, frame_ancestry.

## Notes on this run (added after review)

- **One documented host contacted.** On ria.ru, an ad frame served from `yastatic.net`
  (Yandex) made an image request to `events.myweb3id.io/cookie-sync/yandex` with a `userid`
  parameter (value not stored). The host matches indicators adf-0081 (`events.myweb3id.io`,
  delivery/logging host named in the report body) and adf-0116 (`myweb3id.io`, Discover-Tech /
  Controlium operational infrastructure, Citizen Lab Appendix C), both from The Citizen Lab's
  AdFection report and classified *surveillance* (ad-platform infrastructure), medium
  confidence. Detection: `known_infra.surveillance_contact`, suspicious.
- **What it means:** a cookie-sync between Yandex's ad network and Discover-Tech
  infrastructure, i.e. this profile's identifier was shared with the documented ad platform.
  That is exposure to the delivery path the report describes (Citizen Lab also documents the
  Yandex sync path). It is not evidence of targeting or of anything delivered to the device:
  no NOAS request, no selective response, no validator or C2 contact followed.
- **Firefox** visited the same site in its run without this contact; whether the auction
  differed or Enhanced Tracking Protection suppressed the sync is not known.
- **Third-party domain column:** taken from the extension's in-memory counter (the MV3 service
  worker can restart and reset it); per-site values are not reliable. The runner now counts
  from the page's own requests.

## Summary

- Sites: 50; loaded 50; consent clicked on 16; article opened on 38.
- Requests observed by the sensor: 23435; distinct third-party registrable domains contacted: 41 (auction evidence: a low number means consent did not take effect).
- Detections: 1 (1 suspicious). Contact with documented infrastructure (rules known_infra.*): 1.
- Cumulative in this profile: 1 detections, 1 known-infrastructure observations, 0 high priority.

## Per site

| # | Site | Loaded | Consent clicked | Article | Requests (sensor) | 3rd-party domains (page) | Detections |
|---:|---|:-:|---|:-:|---:|---:|---|
| 1 | www.vg.no | yes | — | yes | 432 | 2 | — |
| 2 | www.dagbladet.no | yes | — | yes | 534 | 44 | — |
| 3 | www.nettavisen.no | yes | — | yes | 684 | 1 | — |
| 4 | www.tv2.no | yes | selector button.sp_choice_type_11 | yes | 579 | 38 | — |
| 5 | www.finn.no | yes | selector button.sp_choice_type_11 | yes | 501 | 16 | — |
| 6 | www.seher.no | yes | selector button.sp_choice_type_11 | yes | 682 | -100 | — |
| 7 | www.kk.no | yes | selector button.sp_choice_type_11 | yes | 599 | 0 | — |
| 8 | www.dinside.no | yes | — | no | 314 | 20 | — |
| 9 | www.klikk.no | yes | selector button.sp_choice_type_11 | yes | 333 | 38 | — |
| 10 | www.dailymail.co.uk | yes | — | no | 0 | -59 | — |
| 11 | www.thesun.co.uk | yes | — | no | 33 | 3 | — |
| 12 | www.mirror.co.uk | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 1896 | 174 | — |
| 13 | nypost.com | yes | selector #onetrust-accept-btn-handler | yes | 943 | 56 | — |
| 14 | www.foxnews.com | yes | — | yes | 516 | 24 | — |
| 15 | www.independent.co.uk | yes | — | yes | 606 | 24 | — |
| 16 | www.express.co.uk | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 1670 | 27 | — |
| 17 | www.flashscore.com | yes | selector #onetrust-accept-btn-handler | yes | 1085 | -290 | — |
| 18 | www.sofascore.com | yes | — | yes | 443 | 9 | — |
| 19 | www.livescore.com | yes | selector #onetrust-accept-btn-handler | yes | 336 | -26 | — |
| 20 | www.goal.com | yes | selector button.sp_choice_type_11 | yes | 467 | 22 | — |
| 21 | www.espn.com | yes | selector #onetrust-accept-btn-handler | yes | 443 | 30 | — |
| 22 | www.azlyrics.com | yes | — | no | 23 | -53 | — |
| 23 | genius.com | yes | — | no | 15 | 0 | — |
| 24 | www.speedtest.net | yes | selector #onetrust-accept-btn-handler | yes | 113 | 1 | — |
| 25 | www.ilovepdf.com | yes | — | yes | 59 | 0 | — |
| 26 | convertio.co | yes | — | no | 26 | 5 | — |
| 27 | www.online-convert.com | yes | — | yes | 169 | -4 | — |
| 28 | www.timeanddate.com | yes | — | no | 12 | -2 | — |
| 29 | poki.com | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 534 | 11 | — |
| 30 | www.crazygames.com | yes | selector button.sp_choice_type_11 | no | 269 | -11 | — |
| 31 | www.boredpanda.com | yes | — | yes | 380 | 38 | — |
| 32 | 9gag.com | yes | — | no | 114 | 14 | — |
| 33 | lenta.ru | yes | — | yes | 980 | 38 | — |
| 34 | ria.ru | yes | — | yes | 574 | 47 | known_infra.surveillance_contact [suspicious] |
| 35 | www.gazeta.ru | yes | — | yes | 894 | 5 | — |
| 36 | www.kp.ru | yes | — | yes | 244 | 10 | — |
| 37 | www.sports.ru | yes | — | yes | 408 | -150 | — |
| 38 | www.blic.rs | yes | — | yes | 376 | 2 | — |
| 39 | www.kurir.rs | yes | — | yes | 1557 | 110 | — |
| 40 | www.b92.net | yes | — | yes | 422 | 10 | — |
| 41 | www.youm7.com | yes | — | yes | 874 | 19 | — |
| 42 | www.masrawy.com | yes | — | yes | 363 | 7 | — |
| 43 | www.aljazeera.net | yes | selector #onetrust-accept-btn-handler | yes | 373 | 20 | — |
| 44 | www.alarabiya.net | yes | — | no | 7 | -170 | — |
| 45 | www.hurriyet.com.tr | yes | — | yes | 394 | 34 | — |
| 46 | www.sozcu.com.tr | yes | — | yes | 459 | 16 | — |
| 47 | punchng.com | yes | — | yes | 287 | 11 | — |
| 48 | www.vanguardngr.com | yes | — | no | 13 | -61 | — |
| 49 | www.ndtv.com | yes | — | no | 0 | 0 | — |
| 50 | www.indiatimes.com | yes | — | yes | 400 | 41 | — |

## Detections

| Rule | Severity | Site | Subject hostnames (elevated and above only) |
|---|---|---|---|
| `known_infra.surveillance_contact` | suspicious | ria.ru | — |

## Reading this

- Results come from the extension's own UI protocol (status and detection list), not from parsed console output, so a page cannot forge them.
- No detection of a documented host means that host did not appear in the ad auctions this profile took part in during this run; it says nothing about other profiles, networks, devices or days. The repeated-exposure rule needs three distinct days in the same profile.
- Consent recognition is heuristic; sites where consent was not clicked ran fewer or no auctions.
