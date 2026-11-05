# Phase 7 plan — The morning line

Written 2026-11-05 by Claude Fable 5.1 (main session) from the roadmap and a code survey.
Implementation is split into two sequential builder tasks (A: background and storage, B: UI and
docs), each followed by the usual checks, then an adversarial review.

## Goal

The popup and the Exposure view answer, from local data only: _what did yesterday's browsing
look like?_ One sentence, a 365-day calendar, and a "your normal" comparison, all computed from
counts the extension already sees. Nothing new leaves the device; nothing new that looks like a
browsing history is stored.

## Decisions (and deviations from the roadmap text)

1. **Pages are counted, never named.** `main_frame` requests are deliberately not observed
   (`main.ts` `shouldObserve`: "that would be a browsing history"). Phase 7 keeps that rule: a
   top-level navigation increments a per-day counter and nothing else. No URL, hostname or
   timestamp of a page is stored.
2. **"Your normal" is per day, not per site.** The roadmap sketched a per-site baseline; that
   needs a table of every site visited, which is a browsing history by another name. Instead each
   page's count of distinct third-party registrable domains (already computed in memory for the
   metrics card) is folded into the day's mean and maximum. The digest compares yesterday's mean
   with the trailing 30-day mean. A per-site baseline, if ever wanted, is opt-in and a later phase.
3. **Day statistics live 400 days** regardless of `detectionRetentionDays`, because they are
   counts plus documented hostnames (public indicator names), not evidence. They are wiped by
   "Delete all data". Detection retention defaults stay unchanged (7 days; the eval profiles set
   365 themselves). No new settings in this phase.
4. **Local calendar days.** Day keys are `YYYY-MM-DD` in the browser's local time zone (the
   person's "yesterday"). `ExposureContact.days` stays UTC; the two are not mixed.
5. **Wording stays conservative.** "0 contacts" always sits next to the existing
   no-detections notice. New strings never say safe, clean, infected or spied on.

## Data model (packages/shared/src/digest.ts, exported from index.ts)

```ts
/** Counts for one local calendar day. Contains no URLs and no per-page records. */
export interface DayStats {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Top-level navigations started (main_frame request_started), capped at 100 000. */
  pages: number;
  /** Pages whose third-party domain count was finalised (closed by a later navigation or tab close). */
  pagesMeasured: number;
  /** Sum of distinct third-party registrable domains over measured pages. */
  thirdPartyDomainsTotal: number;
  /** Highest distinct third-party domain count on one page. */
  thirdPartyDomainsMax: number;
  /** New known_infra.* detections (not severity updates). */
  contacts: number;
  /** Distinct documented hosts contacted, sorted, at most 50. */
  hosts: string[];
  /** New detections at elevated or high_priority (any rule). */
  strong: number;
}

export interface Digest {
  /** Local YYYY-MM-DD of "today" when computed. */
  today: string;
  /** Newest first, at most 400 entries; days with no activity are absent. */
  days: DayStats[];
  /** Mean third-party domains per measured page over the trailing 30 days before today, or null. */
  normalThirdPartyPerPage: number | null;
  /** Most recent day with contacts > 0, or null. */
  lastContact: { date: string; hosts: string[] } | null;
}
```

`UiRequest` gains `{ type: "get_digest" }` → `Digest`. The UI README table is updated.

## Task A — background and storage (sonnet-builder)

Files: `packages/shared/src/digest.ts`, `packages/shared/src/index.ts`,
`packages/shared/src/messages.ts`, `packages/extension-core/src/background/storage.ts`,
`packages/extension-core/src/background/main.ts`, `messages.ts` (request validation),
plus tests `storage.test.ts`, `main.test.ts` (or a new `daily.test.ts`).

1. **storage.ts**: new key `"daily"` holding `Record<string, DayStats>`. Methods:
   `getDay(date)`, `touchDay(date, patch)`-style upsert via a single `updateDay(date, fn)`,
   `listDays()` (newest first), prune to 400 newest in the same `applyRetention` call (date
   order, not age, so a clock jump cannot wipe it), include in `deleteAll` (already
   `storage.local.clear()`), persist with the existing dirty/flush mechanism. Validate shape on
   load (drop malformed entries). Cap `hosts` at 50 sorted strings, `pages` at 100 000.
2. **main.ts**:
   - `localDate(ts)` helper (local time zone) in a small `daily.ts` module next to `main.ts`
     together with the pure per-tab accounting so it is unit-testable without the browser mock:
     `class PageAccounting { onNavigation(tabId, now) → finalised count | null; onThirdParty(tabId, domain); onTabRemoved(tabId) → finalised count | null }`, bounded: at most 200 tabs
     (evict oldest), at most 500 domains per tab.
   - In `shouldObserve`, before the `main_frame` early return: if `resourceType === "main_frame"`
     and `eventType === "request_started"`, call `onNavigation(ev.tabId)` and record the result
     (day `pages++`, and if a finalised count came back, `pagesMeasured++`, add to total and max).
     Verify in both sensors that top-level navigations arrive with `resourceType: "main_frame"`
     and exactly one `request_started` per navigation (redirects reuse the request id and arrive as
     `request_redirected`). If the Chromium sensor does not surface main_frame events to
     `shouldObserve`, say so in the report rather than working around it.
   - In `onEvent`, where `thirdPartyDomains.add(...)` runs, also `onThirdParty(ev.tabId, domain)`
     when `tabId` is a real tab (≥ 0).
   - Tab removal: subscribe to `browser.tabs.onRemoved` in `Background` (the permission exists; the
     Chromium sensor already listens) and finalise that tab.
   - Detections: in the loop after `this.store.addDetection(d, supporting)` for **new** detections
     only (not the `updated` list): if `d.ruleId.startsWith("known_infra.")`, `contacts++` and add
     `d.subjectHostnames[0] ?? indicator name` (same derivation as `summarizeExposure`) to `hosts`;
     if severity is elevated or high_priority, `strong++`.
   - Persistence: day stats changes mark the store dirty; flush rides the existing 2 s snapshot
     timer (`setMetrics` call site) and the hourly alarm. On init, load from storage.
   - `get_digest` handler: build `Digest` from `listDays()`; `normalThirdPartyPerPage` = sum of
     totals / sum of measured over days in `[today-30, today-1]`, null if no measured pages;
     `lastContact` = newest day with `contacts > 0`.
   - `messages.ts`: accept `get_digest` in the request validator.
3. **Tests** (vitest, existing mocks): local-date boundary (23:59 → 00:00 local), accounting
   bounds (201st tab evicts, 501st domain ignored), navigation finalises previous page of the same
   tab only, tab removal finalises, main_frame `request_redirected` does not double count, new
   known_infra detection increments `contacts` and `hosts` once while an update does not, strong
   counts elevated and above, 400-day prune keeps newest by date, malformed stored entries dropped,
   digest `normal` uses only the 30 days before today, `deleteAll` clears days.
4. Run `pnpm typecheck && pnpm lint && pnpm test`. Report: conclusion, files with line refs,
   anything unverified (notably the Chromium main_frame question), next action.

## Task B — UI and docs (sonnet-builder, after A)

Files: `ui/popup.ts`, `ui/views/exposure.ts` (or a new `ui/views/calendar.ts` imported by it),
`ui/i18n.nb.ts`, both `apps/*/public/styles.css` (identical copies), `ui/README.md`,
`docs/privacy.md`, `docs/limitations.md` if relevant, tests `ui/calendar.test.ts` (pure helpers)
and the i18n coverage test (new keys need bokmål entries).

1. **Popup**: `load()` also requests `get_digest`. In `exposureHeadline`, replace the
   "Watching ad traffic: {n} requests observed." sub-line with the morning line when yesterday
   has data: `"Yesterday: {pages} page(s), {contacts} contact(s) with documented infrastructure."`
   plus, when there is a last contact, `"Last contact {date}: {hosts}."` (hosts joined, at most
   three then "+n"). When yesterday has no entry, keep the current line. The footer
   no-detections notice stays.
2. **Exposure view**: a new first section "The last 365 days" with (a) the same morning line,
   (b) the normal comparison when available: `"Yesterday {n} third-party domains per page on
average; your 30-day normal is {m}."`, (c) the calendar.
3. **Calendar** (pure DOM via `h()`, no canvas): a CSS grid, one column per ISO week for the
   last 53 weeks, one row per weekday, newest at the right. Cell classes: `day-empty` (no entry),
   `day-seen` (pages > 0), `day-contact` (contacts > 0), `day-strong` (strong > 0). Each cell is a
   `<button type="button">` with `aria-label` = full date plus the counts, opening nothing but
   showing the same text in a `role="status"` line under the grid on click/focus. Below the grid a
   `<details>` "List days with contacts" with a plain `<ul>` for screen readers and keyboard users.
   Month labels across the top, weekday labels on the left, a legend. Colours from existing tokens;
   contrast ≥ 3:1 against the card background for the three filled states; `prefers-reduced-motion`
   needs nothing special (no animation). Pure helpers in `ui/calendar.ts`: `calendarCells(days,
today)` → 371 cells with date, state and label; `monthLabels(cells)`; tested in jsdom-free
   unit tests.
4. **i18n**: every new `t()` key gets a bokmål entry; placeholders preserved; the existing test
   enforces both. Date formatting via the existing `formatTimestamp`/locale helpers where a date is
   shown in prose; calendar labels use `toLocaleDateString(lang, { dateStyle: "long" })`.
5. **Docs**: UI README (routes and requests), `docs/privacy.md` (what the daily counters are, what
   they are not, 400-day retention, deleted with everything else), CHANGELOG under Unreleased.
6. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `pnpm e2e:firefox` and
   `pnpm e2e:chromium` to confirm nothing regressed in the browsers. Report as in A.

## Review and gate (main session + opus-reviewer)

- Adversarial review of the full diff: privacy (no per-page or per-site records; day keys only),
  bounds (tabs, domains, days, hosts), Chromium service-worker restart (state reload from
  storage; counters survive), wording.
- Gate 7 from the roadmap: digest matches the day's JSON on an eval profile (manual check against
  `~/.cache/adtripwire-exposure/<date>-*.json` `pages`/known contacts); calendar renders from a
  profile with a year of data within budget (synthetic 400-day store in a test, render under
  50 ms in jsdom or measured in the DEV self-test); wording review; keyboard walkthrough done by
  the main session from markup.
- Report in `docs/phase-7-report.md`; roadmap entry updated.

## Known limitations

- Downloads, 204 responses and aborted navigations are counted as pages.
- Toggling monitoring mid-page saves a partial count for that page.
- Before the store is ready, third-party requests of a page are attributed to the tab's current
  page.
- Prerendered pages are skipped (frameId other than 0).
