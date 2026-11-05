# Phase 7 report — The morning line

Date: 2026-11-05. Plan and verification by Claude Fable 5.1 (main session); implementation by two
Sonnet 5.5 builder tasks and one Sonnet fix batch under the main session's plan
(`docs/phase-7-plan.md`); adversarial review of the background and storage diff by Opus 5.5. Phase 7
is the first phase of the forward roadmap written on 2026-11-05.

## What was built

| Item                   | State                  | Notes                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-day counters       | implemented + verified | `DayStats` per local calendar day under the new storage key `daily`: pages started, pages measured, third-party domains total and max, new `known_infra.*` detections, the documented hostnames (indicator names only, at most 50), elevated-or-above detections. 400 days kept by date; validated on load; cleared by "Delete all data".           |
| Page counting          | implemented + verified | Top-level navigations counted in `shouldObserve` before the existing `main_frame` discard; one count per request id (redirect hops are not pages); prerendered or framed loads (`frameId ≠ 0`) skipped; private windows and extension pages excluded upstream. Per-tab third-party domain sets live in memory only (200 tabs, 500 domains per tab). |
| `get_digest`           | implemented + verified | Newest-first days, "normal" = mean third-party domains per measured page over the 30 local days before today, last day with contacts. Validated in the request validator.                                                                                                                                                                           |
| Morning line           | implemented + verified | Popup sub-line and Exposure card: "Yesterday: N page(s), N contact(s) with documented infrastructure. Last contact <date>: <hosts>." Popup "clear" headline now names its window ("…in the last 7 days").                                                                                                                                           |
| Calendar               | implemented + verified | 53 weeks × 7 days, Monday first, one `<button>` per past day with a full-sentence `aria-label`, roving tabindex (one tab stop, arrow keys move a week or a day), a `role="status"` line, a legend and a `<details>` list of days with contacts. Month labels rendered as 53 grid spans (the extension CSP forbids inline styles).                   |
| Localisation           | implemented + verified | 21 new bokmål entries; the coverage test passes.                                                                                                                                                                                                                                                                                                    |
| Settings disclosure    | implemented            | Note under retention: the calendar keeps counts and documented hostnames for 400 days regardless; deleting all data removes them.                                                                                                                                                                                                                   |
| Docs                   | implemented            | `docs/privacy.md` (daily counters), UI README (`get_digest`), CHANGELOG, `docs/phase-7-plan.md` with known limitations.                                                                                                                                                                                                                             |
| Per-site "your normal" | not built (by design)  | The roadmap sketched a per-site baseline; that is a table of visited sites, i.e. a browsing history. Replaced by the per-day mean. See plan, decision 2.                                                                                                                                                                                            |

## Verification

| Check                                     | Result                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit + integration tests                  | 703 passed (49 files), incl. 29 new (`daily.test.ts`, `calendar.test.ts`, storage day counters, `get_digest` validation); daily tests also pass under `TZ=Pacific/Auckland`                                                                                                                      |
| Typecheck, eslint, prettier, build guard  | clean; both extension builds                                                                                                                                                                                                                                                                     |
| Firefox e2e (DEV)                         | 14 PASS, 0 FAIL                                                                                                                                                                                                                                                                                  |
| Chromium e2e (DEV)                        | 12 PASS, 0 FAIL                                                                                                                                                                                                                                                                                  |
| Headless Chromium with 400 synthetic days | 371 cells; today is the last non-future cell; states counted as seeded; one tab stop; ArrowLeft moves 7 cells, ArrowUp 1; status line updates; light and dark screenshots reviewed by the main session; Exposure view navigated and rendered in 289 ms (light) / 211 ms (dark) including the RPC |
| Opus review (background + storage)        | "ship after fixes": 3 medium, 3 low; all three medium and one low fixed, the two remaining low documented as known limitations. UI files were not reviewed by Opus; reviewed by the main session from the screenshots and the diff.                                                              |

Stylesheets of both apps remain byte-identical.

## Gate 7

- Digest matches the day's JSON on an eval profile: **pending**. The daily service rebuilds the
  eval bundles at its next run (2026-11-06 11:30 CET); compare `pages` in the popup with the
  `loaded` count in that day's `~/.cache/adtripwire-exposure/<date>-*.json` afterwards.
- Calendar renders from a year of data within budget: met (headless measurement above).
- Wording reviewed against the conservative-language rule: met (no safe/clean/infected/spied;
  "0 contacts" always sits next to the no-detections notice).
- Keyboard walkthrough: met in headless Chromium (focus, arrows, status line); not performed by a
  person with a screen reader.

## Known limitations (carried in the plan)

Downloads, 204 responses and aborted navigations count as pages; monitoring toggled mid-page
saves a partial count; before the store is ready, a page's third-party requests are attributed
to the tab's current page; after a Chromium service-worker restart the pages already open are
counted but not measured. Day keys are local time, so a time-zone change moves the boundary.
