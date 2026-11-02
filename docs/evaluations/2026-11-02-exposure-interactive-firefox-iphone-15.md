# Interactive exposure run, firefox (iPhone 15 emulation) — 2026-11-02

Script: `scripts/exposure-run.mjs`. Evaluation build 0.2.0 (production indicator set, adfection-2026 2026.11.02), headless firefox, persistent profile `~/snap/firefox/common/adtripwire-exposure-profile-iphone-15`, 75 s per site, consent accepted where a dialog was recognised, scrolled, one article opened. Capabilities: request_metadata, redirect_chain, response_headers, response_size, response_body_inspection, frame_ancestry, third_party_flag, url_classification.

## Notes on this run (added after review)

No contact with documented infrastructure. Uses the retuned `ad_delivery.redirect_chain` rule
(one informational detection per tab). The third-party domain column still came from the
extension counter in this run and is not reliable.

## Summary

- Sites: 50; loaded 50; consent clicked on 27 (no click means no dialog was recognised, or consent was already stored in this persistent profile); article opened on 45.
- Requests observed by the sensor: 36798. Third-party registrable domains per site, counted by this script from the page's own requests: median 37; 6 loaded site(s) contacted fewer than 10, which suggests few or no ad auctions ran there.
- Detections: 40 (13 suspicious, 27 informational). Contact with documented infrastructure (rules known_infra.*): 0.
- Cumulative in this profile: 40 detections, 0 known-infrastructure observations, 0 high priority.

## Per site

| # | Site | Loaded | Consent clicked | Article | Requests (sensor) | 3rd-party domains (page) | Detections |
|---:|---|:-:|---|:-:|---:|---:|---|
| 1 | www.vg.no | yes | selector button.sp_choice_type_11 | yes | 541 | 35 | profiling.identifier_rich_request [informational] |
| 2 | www.dagbladet.no | yes | selector button.sp_choice_type_11 | yes | 543 | 39 | profiling.identifier_rich_request [suspicious]<br>profiling.identifier_rich_request [suspicious] |
| 3 | www.nettavisen.no | yes | selector button.sp_choice_type_11 | yes | 975 | 34 | — |
| 4 | www.tv2.no | yes | selector button.sp_choice_type_11 | yes | 407 | 18 | — |
| 5 | www.finn.no | yes | selector button.sp_choice_type_11 | yes | 667 | 25 | — |
| 6 | www.seher.no | yes | selector button.sp_choice_type_11 | yes | 624 | 34 | profiling.identifier_rich_request [suspicious] |
| 7 | www.kk.no | yes | selector button.sp_choice_type_11 | yes | 570 | 37 | — |
| 8 | www.dinside.no | yes | — | no | 305 | 28 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [informational] |
| 9 | www.klikk.no | yes | selector button.sp_choice_type_11 | yes | 453 | 36 | — |
| 10 | www.dailymail.co.uk | yes | text "Accept" | no | 731 | 109 | ad_delivery.redirect_chain [informational] |
| 11 | www.thesun.co.uk | yes | selector button.sp_choice_type_11 | yes | 1462 | 139 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [informational]<br>profiling.identifier_rich_request [informational] |
| 12 | www.mirror.co.uk | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 2502 | 202 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [informational]<br>profiling.identifier_rich_request [informational]<br>profiling.identifier_rich_request [informational] |
| 13 | nypost.com | yes | selector #onetrust-accept-btn-handler | yes | 667 | 80 | ad_delivery.redirect_chain [informational] |
| 14 | www.foxnews.com | yes | text "OK" | yes | 890 | 73 | — |
| 15 | www.independent.co.uk | yes | — | yes | 1619 | 79 | ad_delivery.redirect_chain [informational] |
| 16 | www.express.co.uk | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 2026 | 168 | ad_delivery.redirect_chain [informational]<br>profiling.identifier_rich_request [suspicious] |
| 17 | www.flashscore.com | yes | selector #onetrust-accept-btn-handler | yes | 2000 | 68 | ad_delivery.redirect_chain [informational] |
| 18 | www.sofascore.com | yes | — | no | 12 | 1 | — |
| 19 | www.livescore.com | yes | selector #onetrust-accept-btn-handler | yes | 1065 | 89 | ad_delivery.redirect_chain [informational] |
| 20 | www.goal.com | yes | selector button.sp_choice_type_11 | yes | 1390 | 123 | ad_delivery.redirect_chain [informational]<br>profiling.identifier_rich_request [suspicious] |
| 21 | www.espn.com | yes | selector #onetrust-accept-btn-handler | yes | 512 | 27 | — |
| 22 | www.azlyrics.com | yes | selector #CybotCookiebotDialogBodyButtonAccept | yes | 1531 | 154 | profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [informational] |
| 23 | genius.com | yes | selector #onetrust-accept-btn-handler | yes | 932 | 151 | ad_delivery.redirect_chain [informational] |
| 24 | www.speedtest.net | yes | selector #onetrust-accept-btn-handler | yes | 901 | 131 | ad_delivery.redirect_chain [informational] |
| 25 | www.ilovepdf.com | yes | — | yes | 59 | 5 | — |
| 26 | convertio.co | yes | — | no | 23 | 6 | — |
| 27 | www.online-convert.com | yes | — | yes | 212 | 7 | — |
| 28 | www.timeanddate.com | yes | — | yes | 114 | 9 | — |
| 29 | poki.com | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 439 | 11 | — |
| 30 | www.crazygames.com | yes | selector button.sp_choice_type_11 | yes | 961 | 70 | ad_delivery.redirect_chain [informational] |
| 31 | www.boredpanda.com | yes | selector button#didomi-notice-agree-button | yes | 1365 | 152 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [informational] |
| 32 | 9gag.com | yes | — | no | 73 | 3 | — |
| 33 | lenta.ru | yes | — | yes | 1334 | 42 | ad_delivery.redirect_chain [informational] |
| 34 | ria.ru | yes | — | yes | 507 | 22 | — |
| 35 | www.gazeta.ru | yes | — | yes | 653 | 37 | ad_delivery.redirect_chain [informational] |
| 36 | www.kp.ru | yes | — | yes | 277 | 37 | ad_delivery.redirect_chain [informational] |
| 37 | www.sports.ru | yes | — | yes | 462 | 16 | — |
| 38 | www.blic.rs | yes | — | yes | 278 | 28 | — |
| 39 | www.kurir.rs | yes | — | yes | 1249 | 101 | profiling.identifier_rich_request [suspicious]<br>profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [informational] |
| 40 | www.b92.net | yes | selector button#didomi-notice-agree-button | yes | 1447 | 117 | ad_delivery.redirect_chain [informational] |
| 41 | www.youm7.com | yes | — | yes | 342 | 33 | — |
| 42 | www.masrawy.com | yes | — | yes | 360 | 39 | ad_delivery.redirect_chain [informational] |
| 43 | www.aljazeera.net | yes | selector #onetrust-accept-btn-handler | yes | 343 | 22 | — |
| 44 | www.alarabiya.net | yes | — | yes | 177 | 16 | — |
| 45 | www.hurriyet.com.tr | yes | — | yes | 460 | 25 | — |
| 46 | www.sozcu.com.tr | yes | — | yes | 463 | 33 | — |
| 47 | punchng.com | yes | — | yes | 417 | 24 | — |
| 48 | www.vanguardngr.com | yes | — | yes | 309 | 23 | — |
| 49 | www.ndtv.com | yes | text "Consent" | yes | 648 | 63 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [informational]<br>profiling.identifier_rich_request [suspicious] |
| 50 | www.indiatimes.com | yes | — | yes | 501 | 47 | — |

## Detections

| Rule | Severity | Site | Subject hostnames (documented infrastructure, elevated and above) |
|---|---|---|---|
| `profiling.identifier_rich_request` | informational | www.vg.no | — |
| `profiling.identifier_rich_request` | suspicious | www.dagbladet.no | — |
| `profiling.identifier_rich_request` | suspicious | www.dagbladet.no | — |
| `profiling.identifier_rich_request` | suspicious | www.seher.no | — |
| `profiling.identifier_rich_request` | suspicious | www.dinside.no | — |
| `ad_delivery.redirect_chain` | informational | www.dinside.no | — |
| `ad_delivery.redirect_chain` | informational | www.dailymail.co.uk | — |
| `profiling.identifier_rich_request` | suspicious | www.thesun.co.uk | — |
| `ad_delivery.redirect_chain` | informational | www.thesun.co.uk | — |
| `profiling.identifier_rich_request` | informational | www.thesun.co.uk | — |
| `profiling.identifier_rich_request` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | informational | www.mirror.co.uk | — |
| `profiling.identifier_rich_request` | informational | www.mirror.co.uk | — |
| `profiling.identifier_rich_request` | informational | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | informational | nypost.com | — |
| `ad_delivery.redirect_chain` | informational | www.independent.co.uk | — |
| `ad_delivery.redirect_chain` | informational | www.express.co.uk | — |
| `profiling.identifier_rich_request` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | informational | www.flashscore.com | — |
| `ad_delivery.redirect_chain` | informational | www.livescore.com | — |
| `ad_delivery.redirect_chain` | informational | www.goal.com | — |
| `profiling.identifier_rich_request` | suspicious | www.goal.com | — |
| `profiling.identifier_rich_request` | informational | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | informational | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | informational | genius.com | — |
| `ad_delivery.redirect_chain` | informational | www.speedtest.net | — |
| `ad_delivery.redirect_chain` | informational | www.crazygames.com | — |
| `profiling.identifier_rich_request` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | informational | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | informational | lenta.ru | — |
| `ad_delivery.redirect_chain` | informational | www.gazeta.ru | — |
| `ad_delivery.redirect_chain` | informational | www.kp.ru | — |
| `profiling.identifier_rich_request` | suspicious | www.kurir.rs | — |
| `profiling.identifier_rich_request` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | informational | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | informational | www.b92.net | — |
| `ad_delivery.redirect_chain` | informational | www.masrawy.com | — |
| `profiling.identifier_rich_request` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | informational | www.ndtv.com | — |
| `profiling.identifier_rich_request` | suspicious | www.ndtv.com | — |

## Reading this

- Results come from the extension's own UI protocol (status and detection list), not from parsed console output, so a page cannot forge them.
- No detection of a documented host means that host did not appear in the ad auctions this profile took part in during this run; it says nothing about other profiles, networks, devices or days. The repeated-exposure rule needs three distinct days in the same profile.
- Consent recognition is heuristic; sites where consent was not clicked ran fewer or no auctions.
