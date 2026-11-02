# Interactive exposure run, firefox — 2026-11-02

Script: `scripts/exposure-run.mjs`. Evaluation build 0.2.0 (production indicator set, adfection-2026 2026.11.02), headless firefox, persistent profile `~/snap/firefox/common/adtripwire-exposure-profile`, 75 s per site, consent accepted where a dialog was recognised, scrolled, one article opened. Capabilities: request_metadata, redirect_chain, response_headers, response_size, response_body_inspection, frame_ancestry, third_party_flag, url_classification.

## Notes on this run (added after review)

- **Outcome:** 50 ad-heavy sites, all loaded; no contact with any of the 167 documented hosts;
  no elevated or high-priority detections.
- **Rule version:** this run used the evaluation build from before the `ad_delivery.redirect_chain`
  retune (commit 3507569). Under the old rule every cookie-sync chain was a separate
  "suspicious" detection, which accounts for 315 of the 346 detections below. Under the tuned
  rule the same traffic yields one informational detection per tab (verified on a two-site
  sample: 74 → 7). See `2026-11-02-benign-consent-firefox.md` for a run with the tuned rule.
- **Third-party domain column:** taken from the extension's in-memory counter, which resets
  when the Firefox event page is suspended; the per-site values (including negative ones) are
  not reliable. The runner now counts from the page's own requests (commit abfe8e4).
- **Consent:** sites visited earlier in the same persistent profile had consent stored, so
  "no click" there does not mean auctions were absent.

## Summary

- Sites: 50; loaded 50; consent clicked on 20; article opened on 44.
- Requests observed by the sensor: 41997; distinct third-party registrable domains contacted: 193 (auction evidence: a low number means consent did not take effect).
- Detections: 346 (327 suspicious, 19 informational). Contact with documented infrastructure (rules known_infra.*): 0.
- Cumulative in this profile: 356 detections, 0 known-infrastructure observations, 0 high priority.

## Per site

| # | Site | Loaded | Consent clicked | Article | Requests (sensor) | 3rd-party domains (page) | Detections |
|---:|---|:-:|---|:-:|---:|---:|---|
| 1 | www.vg.no | yes | — | yes | 463 | 1 | profiling.identifier_rich_request [informational] |
| 2 | www.dagbladet.no | yes | — | yes | 701 | 91 | profiling.identifier_rich_request [suspicious]<br>profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 3 | www.nettavisen.no | yes | — | yes | 1135 | -89 | — |
| 4 | www.tv2.no | yes | — | yes | 623 | 54 | ad_delivery.redirect_chain [suspicious] |
| 5 | www.finn.no | yes | — | yes | 1031 | 30 | — |
| 6 | www.seher.no | yes | selector button.sp_choice_type_11 | yes | 962 | 30 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>profiling.identifier_rich_request [suspicious]<br>profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 7 | www.kk.no | yes | selector button.sp_choice_type_11 | yes | 866 | 11 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 8 | www.dinside.no | yes | — | no | 513 | 1 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 9 | www.klikk.no | yes | selector button.sp_choice_type_11 | yes | 366 | 11 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 10 | www.dailymail.co.uk | yes | text "Accept" | no | 1110 | 49 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 11 | www.thesun.co.uk | yes | selector button.sp_choice_type_11 | yes | 632 | 35 | profiling.identifier_rich_request [informational] |
| 12 | www.mirror.co.uk | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 2553 | 91 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 13 | nypost.com | yes | selector #onetrust-accept-btn-handler | yes | 1548 | 45 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 14 | www.foxnews.com | yes | — | yes | 765 | 27 | — |
| 15 | www.independent.co.uk | yes | — | yes | 1200 | 19 | — |
| 16 | www.express.co.uk | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 2802 | 15 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 17 | www.flashscore.com | yes | selector #onetrust-accept-btn-handler | yes | 1578 | 10 | ad_delivery.redirect_chain [suspicious] |
| 18 | www.sofascore.com | yes | — | yes | 478 | 4 | — |
| 19 | www.livescore.com | yes | selector #onetrust-accept-btn-handler | yes | 1762 | 9 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 20 | www.goal.com | yes | selector button.sp_choice_type_11 | yes | 705 | -438 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 21 | www.espn.com | yes | selector #onetrust-accept-btn-handler | yes | 600 | 49 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 22 | www.azlyrics.com | yes | selector #CybotCookiebotDialogBodyButtonAccept | yes | 2153 | 134 | profiling.identifier_rich_request [informational]<br>profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>profiling.identifier_rich_request [informational]<br>profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [suspicious] |
| 23 | genius.com | yes | selector #onetrust-accept-btn-handler | no | 2010 | 68 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 24 | www.speedtest.net | yes | selector #onetrust-accept-btn-handler | yes | 104 | -256 | — |
| 25 | www.ilovepdf.com | yes | — | yes | 87 | 6 | — |
| 26 | convertio.co | yes | — | no | 26 | 2 | — |
| 27 | www.online-convert.com | yes | — | yes | 221 | -8 | — |
| 28 | www.timeanddate.com | yes | — | yes | 164 | -1 | — |
| 29 | poki.com | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 600 | 11 | — |
| 30 | www.crazygames.com | yes | selector button.sp_choice_type_11 | no | 276 | -11 | — |
| 31 | www.boredpanda.com | yes | selector button#didomi-notice-agree-button | yes | 1843 | 194 | ad_delivery.redirect_chain [suspicious]<br>profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [suspicious]<br>profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 32 | 9gag.com | yes | — | no | 66 | -193 | — |
| 33 | lenta.ru | yes | — | yes | 944 | 41 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 34 | ria.ru | yes | — | yes | 458 | 11 | — |
| 35 | www.gazeta.ru | yes | — | yes | 937 | 4 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 36 | www.kp.ru | yes | — | yes | 244 | 16 | ad_delivery.redirect_chain [suspicious] |
| 37 | www.sports.ru | yes | — | yes | 457 | -71 | — |
| 38 | www.blic.rs | yes | — | yes | 370 | 33 | — |
| 39 | www.kurir.rs | yes | — | yes | 1730 | 144 | profiling.identifier_rich_request [suspicious]<br>profiling.identifier_rich_request [suspicious]<br>profiling.identifier_rich_request [informational]<br>profiling.identifier_rich_request [informational]<br>profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 40 | www.b92.net | yes | selector button#didomi-notice-agree-button | yes | 942 | 19 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 41 | www.youm7.com | yes | — | yes | 931 | 16 | — |
| 42 | www.masrawy.com | yes | — | yes | 1003 | 13 | profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 43 | www.aljazeera.net | yes | selector #onetrust-accept-btn-handler | yes | 384 | 11 | — |
| 44 | www.alarabiya.net | yes | — | yes | 245 | -238 | — |
| 45 | www.hurriyet.com.tr | yes | — | yes | 584 | 5 | — |
| 46 | www.sozcu.com.tr | yes | — | yes | 509 | 28 | — |
| 47 | punchng.com | yes | — | yes | 356 | 10 | — |
| 48 | www.vanguardngr.com | yes | — | yes | 331 | 14 | — |
| 49 | www.ndtv.com | yes | — | yes | 1131 | 107 | ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious]<br>ad_delivery.redirect_chain [suspicious] |
| 50 | www.indiatimes.com | yes | — | yes | 498 | 29 | profiling.identifier_rich_request [informational]<br>profiling.identifier_rich_request [informational]<br>profiling.identifier_rich_request [informational]<br>profiling.identifier_rich_request [informational] |

## Detections

| Rule | Severity | Site | Subject hostnames (elevated and above only) |
|---|---|---|---|
| `profiling.identifier_rich_request` | informational | www.vg.no | — |
| `profiling.identifier_rich_request` | suspicious | www.dagbladet.no | — |
| `profiling.identifier_rich_request` | suspicious | www.dagbladet.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.dagbladet.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.dagbladet.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.dagbladet.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.dagbladet.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.tv2.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.seher.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.seher.no | — |
| `profiling.identifier_rich_request` | suspicious | www.seher.no | — |
| `profiling.identifier_rich_request` | suspicious | www.seher.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.seher.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.seher.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.seher.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.kk.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.kk.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.kk.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.kk.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.kk.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.dinside.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.dinside.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.dinside.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.klikk.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.klikk.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.klikk.no | — |
| `ad_delivery.redirect_chain` | suspicious | www.klikk.no | — |
| `profiling.identifier_rich_request` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `profiling.identifier_rich_request` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.dailymail.co.uk | — |
| `profiling.identifier_rich_request` | informational | www.thesun.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `profiling.identifier_rich_request` | informational | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.mirror.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | nypost.com | — |
| `ad_delivery.redirect_chain` | suspicious | nypost.com | — |
| `ad_delivery.redirect_chain` | suspicious | nypost.com | — |
| `ad_delivery.redirect_chain` | suspicious | nypost.com | — |
| `ad_delivery.redirect_chain` | suspicious | nypost.com | — |
| `ad_delivery.redirect_chain` | suspicious | nypost.com | — |
| `ad_delivery.redirect_chain` | suspicious | nypost.com | — |
| `ad_delivery.redirect_chain` | suspicious | nypost.com | — |
| `ad_delivery.redirect_chain` | suspicious | nypost.com | — |
| `profiling.identifier_rich_request` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `profiling.identifier_rich_request` | informational | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `profiling.identifier_rich_request` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `profiling.identifier_rich_request` | informational | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.express.co.uk | — |
| `ad_delivery.redirect_chain` | suspicious | www.flashscore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.livescore.com | — |
| `profiling.identifier_rich_request` | suspicious | www.goal.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.goal.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.goal.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.espn.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.espn.com | — |
| `profiling.identifier_rich_request` | informational | www.azlyrics.com | — |
| `profiling.identifier_rich_request` | informational | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `profiling.identifier_rich_request` | informational | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `profiling.identifier_rich_request` | informational | www.azlyrics.com | — |
| `profiling.identifier_rich_request` | informational | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.azlyrics.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | genius.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `profiling.identifier_rich_request` | informational | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `profiling.identifier_rich_request` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.boredpanda.com | — |
| `ad_delivery.redirect_chain` | suspicious | lenta.ru | — |
| `ad_delivery.redirect_chain` | suspicious | lenta.ru | — |
| `ad_delivery.redirect_chain` | suspicious | lenta.ru | — |
| `ad_delivery.redirect_chain` | suspicious | lenta.ru | — |
| `ad_delivery.redirect_chain` | suspicious | www.gazeta.ru | — |
| `ad_delivery.redirect_chain` | suspicious | www.gazeta.ru | — |
| `ad_delivery.redirect_chain` | suspicious | www.gazeta.ru | — |
| `ad_delivery.redirect_chain` | suspicious | www.gazeta.ru | — |
| `ad_delivery.redirect_chain` | suspicious | www.kp.ru | — |
| `profiling.identifier_rich_request` | suspicious | www.kurir.rs | — |
| `profiling.identifier_rich_request` | suspicious | www.kurir.rs | — |
| `profiling.identifier_rich_request` | informational | www.kurir.rs | — |
| `profiling.identifier_rich_request` | informational | www.kurir.rs | — |
| `profiling.identifier_rich_request` | informational | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.kurir.rs | — |
| `ad_delivery.redirect_chain` | suspicious | www.b92.net | — |
| `ad_delivery.redirect_chain` | suspicious | www.b92.net | — |
| `ad_delivery.redirect_chain` | suspicious | www.b92.net | — |
| `ad_delivery.redirect_chain` | suspicious | www.b92.net | — |
| `ad_delivery.redirect_chain` | suspicious | www.b92.net | — |
| `ad_delivery.redirect_chain` | suspicious | www.b92.net | — |
| `profiling.identifier_rich_request` | informational | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.masrawy.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `ad_delivery.redirect_chain` | suspicious | www.ndtv.com | — |
| `profiling.identifier_rich_request` | informational | www.indiatimes.com | — |
| `profiling.identifier_rich_request` | informational | www.indiatimes.com | — |
| `profiling.identifier_rich_request` | informational | www.indiatimes.com | — |
| `profiling.identifier_rich_request` | informational | www.indiatimes.com | — |

## Reading this

- Results come from the extension's own UI protocol (status and detection list), not from parsed console output, so a page cannot forge them.
- No detection of a documented host means that host did not appear in the ad auctions this profile took part in during this run; it says nothing about other profiles, networks, devices or days. The repeated-exposure rule needs three distinct days in the same profile.
- Consent recognition is heuristic; sites where consent was not clicked ran fewer or no auctions.
