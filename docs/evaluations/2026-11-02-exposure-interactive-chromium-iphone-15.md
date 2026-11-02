# Interactive exposure run, chromium (iPhone 15 emulation) — 2026-11-02

Script: `scripts/exposure-run.mjs`. Evaluation build 0.2.0 (production indicator set, adfection-2026 2026.11.02), headless chromium, persistent profile `~/snap/chromium/common/adtripwire-exposure-profile-iphone-15`, 75 s per site, consent accepted where a dialog was recognised, scrolled, one article opened. Capabilities: request_metadata, redirect_chain, response_headers, response_size, frame_ancestry.

## Notes on this run (added after review)

No contact with documented infrastructure. Uses the retuned `ad_delivery.redirect_chain` rule
(one informational detection per tab). The third-party domain column still came from the
extension counter in this run and is not reliable.

## Summary

- Sites: 50; loaded 50; consent clicked on 26 (no click means no dialog was recognised, or consent was already stored in this persistent profile); article opened on 44.
- Requests observed by the sensor: 31589. Third-party registrable domains per site, counted by this script from the page's own requests: median 36; 6 loaded site(s) contacted fewer than 10, which suggests few or no ad auctions ran there.
- Detections: 0. Contact with documented infrastructure (rules known_infra.*): 0.
- Cumulative in this profile: 0 detections, 0 known-infrastructure observations, 0 high priority.

## Per site

| # | Site | Loaded | Consent clicked | Article | Requests (sensor) | 3rd-party domains (page) | Detections |
|---:|---|:-:|---|:-:|---:|---:|---|
| 1 | www.vg.no | yes | selector button.sp_choice_type_11 | yes | 523 | 33 | — |
| 2 | www.dagbladet.no | yes | selector button.sp_choice_type_11 | yes | 603 | 41 | — |
| 3 | www.nettavisen.no | yes | selector button.sp_choice_type_11 | yes | 586 | 31 | — |
| 4 | www.tv2.no | yes | selector button.sp_choice_type_11 | yes | 397 | 18 | — |
| 5 | www.finn.no | yes | selector button.sp_choice_type_11 | yes | 417 | 26 | — |
| 6 | www.seher.no | yes | selector button.sp_choice_type_11 | yes | 675 | 35 | — |
| 7 | www.kk.no | yes | selector button.sp_choice_type_11 | yes | 565 | 38 | — |
| 8 | www.dinside.no | yes | — | no | 264 | 27 | — |
| 9 | www.klikk.no | yes | selector button.sp_choice_type_11 | yes | 440 | 37 | — |
| 10 | www.dailymail.co.uk | yes | text "Accept" | no | 521 | 80 | — |
| 11 | www.thesun.co.uk | yes | selector button.sp_choice_type_11 | yes | 1204 | 105 | — |
| 12 | www.mirror.co.uk | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 2170 | 184 | — |
| 13 | nypost.com | yes | selector #onetrust-accept-btn-handler | yes | 909 | 108 | — |
| 14 | www.foxnews.com | yes | text "OK" | yes | 884 | 80 | — |
| 15 | www.independent.co.uk | yes | — | yes | 1051 | 81 | — |
| 16 | www.express.co.uk | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 1500 | 113 | — |
| 17 | www.flashscore.com | yes | selector #onetrust-accept-btn-handler | yes | 1430 | 68 | — |
| 18 | www.sofascore.com | yes | — | no | 12 | 1 | — |
| 19 | www.livescore.com | yes | selector #onetrust-accept-btn-handler | yes | 661 | 64 | — |
| 20 | www.goal.com | yes | selector button.sp_choice_type_11 | yes | 1622 | 117 | — |
| 21 | www.espn.com | yes | selector #onetrust-accept-btn-handler | yes | 496 | 27 | — |
| 22 | www.azlyrics.com | yes | selector #CybotCookiebotDialogBodyButtonAccept | yes | 1083 | 100 | — |
| 23 | genius.com | yes | selector #onetrust-accept-btn-handler | yes | 1267 | 145 | — |
| 24 | www.speedtest.net | yes | selector #onetrust-accept-btn-handler | yes | 565 | 66 | — |
| 25 | www.ilovepdf.com | yes | — | yes | 51 | 5 | — |
| 26 | convertio.co | yes | — | no | 18 | 5 | — |
| 27 | www.online-convert.com | yes | — | yes | 165 | 7 | — |
| 28 | www.timeanddate.com | yes | — | yes | 95 | 9 | — |
| 29 | poki.com | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 434 | 11 | — |
| 30 | www.crazygames.com | yes | selector button.sp_choice_type_11 | yes | 615 | 33 | — |
| 31 | www.boredpanda.com | yes | selector button#didomi-notice-agree-button | yes | 893 | 99 | — |
| 32 | 9gag.com | yes | — | no | 92 | 3 | — |
| 33 | lenta.ru | yes | — | yes | 1781 | 57 | — |
| 34 | ria.ru | yes | — | yes | 525 | 21 | — |
| 35 | www.gazeta.ru | yes | — | yes | 715 | 36 | — |
| 36 | www.kp.ru | yes | — | yes | 238 | 38 | — |
| 37 | www.sports.ru | yes | — | yes | 443 | 16 | — |
| 38 | www.blic.rs | yes | — | yes | 262 | 31 | — |
| 39 | www.kurir.rs | yes | — | yes | 1520 | 92 | — |
| 40 | www.b92.net | yes | selector button#didomi-notice-agree-button | no | 477 | 58 | — |
| 41 | www.youm7.com | yes | — | yes | 319 | 29 | — |
| 42 | www.masrawy.com | yes | — | yes | 363 | 41 | — |
| 43 | www.aljazeera.net | yes | selector #onetrust-accept-btn-handler | yes | 331 | 32 | — |
| 44 | www.alarabiya.net | yes | — | yes | 172 | 15 | — |
| 45 | www.hurriyet.com.tr | yes | — | yes | 307 | 25 | — |
| 46 | www.sozcu.com.tr | yes | — | yes | 417 | 30 | — |
| 47 | punchng.com | yes | — | yes | 314 | 21 | — |
| 48 | www.vanguardngr.com | yes | — | yes | 261 | 21 | — |
| 49 | www.ndtv.com | yes | — | yes | 426 | 46 | — |
| 50 | www.indiatimes.com | yes | — | yes | 510 | 44 | — |

## Detections

None during this run.

## Reading this

- Results come from the extension's own UI protocol (status and detection list), not from parsed console output, so a page cannot forge them.
- No detection of a documented host means that host did not appear in the ad auctions this profile took part in during this run; it says nothing about other profiles, networks, devices or days. The repeated-exposure rule needs three distinct days in the same profile.
- Consent recognition is heuristic; sites where consent was not clicked ran fewer or no auctions.
