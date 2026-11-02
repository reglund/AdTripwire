# Interactive exposure run, firefox — 2026-11-02

Script: `scripts/exposure-run.mjs`. Evaluation build 0.2.0 (production indicator set, adfection-2026 2026.11.02), headless firefox, persistent profile `~/snap/firefox/common/adtripwire-benign-consent-profile`, 60 s per site, consent accepted where a dialog was recognised, scrolled, one article opened. Capabilities: request_metadata, redirect_chain, response_headers, response_size, response_body_inspection, frame_ancestry, third_party_flag, url_classification.

## Summary

- Sites: 24; loaded 24; consent clicked on 16 (no click means no dialog was recognised, or consent was already stored in this persistent profile); article opened on 20.
- Requests observed by the sensor: 16728. Third-party registrable domains per site, counted by this script from the page's own requests: median 52; 5 loaded site(s) contacted fewer than 10, which suggests few or no ad auctions ran there.
- Detections: 21 (6 suspicious, 15 informational). Contact with documented infrastructure (rules known_infra.*): 0.
- Cumulative in this profile: 21 detections, 0 known-infrastructure observations, 0 high priority.

## Per site

| # | Site | Loaded | Consent clicked | Article | Requests (sensor) | 3rd-party domains (page) | Detections |
|---:|---|:-:|---|:-:|---:|---:|---|
| 1 | www.vg.no | yes | selector button.sp_choice_type_11 | yes | 577 | 34 | — |
| 2 | www.dagbladet.no | yes | selector button.sp_choice_type_11 | yes | 612 | 79 | ad_delivery.redirect_chain [informational]<br>profiling.identifier_rich_request [suspicious]<br>profiling.identifier_rich_request [suspicious] |
| 3 | www.nrk.no | yes | — | yes | 270 | 3 | — |
| 4 | www.aftenposten.no | yes | selector button.sp_choice_type_11 | yes | 497 | 36 | — |
| 5 | www.tv2.no | yes | selector button.sp_choice_type_11 | yes | 568 | 52 | ad_delivery.redirect_chain [informational] |
| 6 | www.nettavisen.no | yes | selector button.sp_choice_type_11 | yes | 864 | 31 | — |
| 7 | www.bbc.com | yes | text "Yes, I agree" | yes | 216 | 6 | — |
| 8 | www.theguardian.com | yes | selector button.sp_choice_type_11 | yes | 1120 | 112 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [informational] |
| 9 | edition.cnn.com | yes | selector #onetrust-accept-btn-handler | yes | 631 | 89 | — |
| 10 | www.reuters.com | yes | selector #onetrust-accept-btn-handler | no | 904 | 151 | ad_delivery.redirect_chain [informational]<br>profiling.identifier_rich_request [informational] |
| 11 | www.spiegel.de | yes | selector button.sp_choice_type_11 | yes | 1107 | 118 | ad_delivery.redirect_chain [informational] |
| 12 | www.lemonde.fr | yes | — | yes | 97 | 8 | — |
| 13 | www.elpais.com | yes | — | yes | 253 | 23 | — |
| 14 | www.repubblica.it | yes | — | no | 229 | 18 | profiling.identifier_rich_request [informational] |
| 15 | www.espn.com | yes | selector #onetrust-accept-btn-handler | yes | 679 | 57 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [informational] |
| 16 | www.allrecipes.com | yes | — | yes | 477 | 47 | — |
| 17 | www.weather.com | yes | selector button.sp_choice_type_11 | yes | 2177 | 147 | ad_delivery.redirect_chain [informational]<br>profiling.identifier_rich_request [informational] |
| 18 | www.imdb.com | yes | — | no | 17 | 2 | — |
| 19 | www.reddit.com | yes | — | no | 4 | 1 | — |
| 20 | www.finn.no | yes | selector button.sp_choice_type_11 | yes | 901 | 53 | profiling.identifier_rich_request [suspicious]<br>ad_delivery.redirect_chain [informational] |
| 21 | www.cnet.com | yes | selector #onetrust-accept-btn-handler | yes | 1195 | 108 | ad_delivery.redirect_chain [informational] |
| 22 | www.theverge.com | yes | selector #onetrust-accept-btn-handler | yes | 1360 | 68 | profiling.identifier_rich_request [informational]<br>ad_delivery.redirect_chain [informational]<br>profiling.identifier_rich_request [suspicious] |
| 23 | www.wired.com | yes | — | yes | 206 | 10 | — |
| 24 | www.ign.com | yes | selector .qc-cmp2-summary-buttons button[mode=primary] | yes | 1767 | 161 | ad_delivery.redirect_chain [informational] |

## Detections

| Rule | Severity | Site | Subject hostnames (elevated and above only) |
|---|---|---|---|
| `ad_delivery.redirect_chain` | informational | www.dagbladet.no | — |
| `profiling.identifier_rich_request` | suspicious | www.dagbladet.no | — |
| `profiling.identifier_rich_request` | suspicious | www.dagbladet.no | — |
| `ad_delivery.redirect_chain` | informational | www.tv2.no | — |
| `profiling.identifier_rich_request` | suspicious | www.theguardian.com | — |
| `ad_delivery.redirect_chain` | informational | www.theguardian.com | — |
| `ad_delivery.redirect_chain` | informational | www.reuters.com | — |
| `profiling.identifier_rich_request` | informational | www.reuters.com | — |
| `ad_delivery.redirect_chain` | informational | www.spiegel.de | — |
| `profiling.identifier_rich_request` | informational | www.repubblica.it | — |
| `profiling.identifier_rich_request` | suspicious | www.espn.com | — |
| `ad_delivery.redirect_chain` | informational | www.espn.com | — |
| `ad_delivery.redirect_chain` | informational | www.weather.com | — |
| `profiling.identifier_rich_request` | informational | www.weather.com | — |
| `profiling.identifier_rich_request` | suspicious | www.finn.no | — |
| `ad_delivery.redirect_chain` | informational | www.finn.no | — |
| `ad_delivery.redirect_chain` | informational | www.cnet.com | — |
| `profiling.identifier_rich_request` | informational | www.theverge.com | — |
| `ad_delivery.redirect_chain` | informational | www.theverge.com | — |
| `profiling.identifier_rich_request` | suspicious | www.theverge.com | — |
| `ad_delivery.redirect_chain` | informational | www.ign.com | — |

## Reading this

- Results come from the extension's own UI protocol (status and detection list), not from parsed console output, so a page cannot forge them.
- No detection of a documented host means that host did not appear in the ad auctions this profile took part in during this run; it says nothing about other profiles, networks, devices or days. The repeated-exposure rule needs three distinct days in the same profile.
- Consent recognition is heuristic; sites where consent was not clicked ran fewer or no auctions.
