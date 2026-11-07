# Seen alongside — plan (Phase 10, second half, part 1)

Status: **implemented 2026-11-07, unreleased.** Plan by Claude Opus 5.5 (main session); built by
sonnet-builder (three rounds); reviewed by opus-reviewer: fix-then-ship (own-site leak via
same-site iframes and navigation, baseline retention, strict profile, rig attribution), fixes
re-reviewed: ship. Unit, integration and both e2e runs pass. Not yet observed on real traffic.

## What it is

A list of hostnames that keep showing up in the same ad frame as a _documented_ host from the
indicator set. Leads for a researcher to look at — candidates for the rotating staging and
delivery hosts the Citizen Lab / Confiant reports could not enumerate. Never a detection,
never a severity, never "this host is bad".

## What the data says (measured before planning)

From the 27 local observatory runs (1134 site visits, 2–6 Nov 2026):

- 447 visits had a detection, but almost all are `ad_delivery.redirect_chain`,
  `profiling.identifier_rich_request` and `page.hidden_iframe_after_load` on mainstream
  ad-tech (`ads.pubmatic.com` 388, `csync.smilewanted.com` 215, `rtb.gumgum.com` 110 …).
  Anchoring on _any_ detection would list the whole ad auction. Useless as leads.
- Only **5** visits matched the indicator set itself (`known_infra.*`):
  `tracookiepixel.xyz` (goal.com, independent.co.uk) and `events.myweb3id.io` (lenta.ru,
  gazeta.ru, ria.ru).

**Decision 1 — the anchor is an indicator match, nothing else.** An event whose destination
matches an enabled indicator (classification `surveillance` or `malicious`; `contextual`
excluded, since those are mainstream companies). Heuristic rules never anchor.

**Unknown: where real anchors sit.** All five real hits came from Chromium runs (no frame
ancestry) and those runs did not store evidence, so it is not known whether the anchor request
was in an ad iframe or in the top document. If most real anchors turn out to be top-document,
they only produce `scope: "page"` entries and the ranked list stays empty even as data
accumulates. Firefox rigs and the first weeks of data will answer this; the page must show
page-scope counts so an empty ranking is explainable.

**Consequence: the list will be short and fill slowly** (≈1 anchor per 200 visits today).
That is honest; the page says so. A frequency baseline (Decision 3) keeps mainstream
ad-tech from dominating whatever does accumulate.

## Design

### 1. Collection (one implementation, used by the extension and the rig)

New pure module `packages/correlation/src/alongside.ts`:

- `AlongsideTracker` with an _open-anchor_ registry: when an indicator-matching event enters
  the window, open an anchor (anchor host, indicator id, tab, frame context, time) for
  `ALONGSIDE_WINDOW_MS = 60_000`.
- On open: scan the current window backwards; afterwards, each new event is tested against
  open anchors (late creatives arrive after the auction). Bounded: ≤ 32 open anchors.
- Relation: reuse `lineageRelation` (move it from `detection-engine/src/rules/correlation-common.ts`
  to `@adtripwire/shared` or export it from `detection-engine`; correlation must not grow a
  dependency on rule internals). Record only `"related"`.
  - Firefox: full frame ancestry → frame-scope relations.
  - Chromium: no ancestry → only same-frame / frame-load-by relations count; lower coverage,
    stated on the page. Same-tab-only (`"unknown"`) is **not** recorded: it is the whole page.
- Anchor in the top document (frame 0): relation degrades to "everything the top document
  loaded", i.e. the page. Recorded with `scope: "page"`, kept separate and shown greyed;
  only `scope: "frame"` counts toward the ranking.
- Excluded candidates: the anchor host itself, any host matching the indicator set (already
  documented), the page's own registrable domain (never enters the window anyway — first
  party is filtered in `shouldObserve`), loopback/IP literals, reserved TLDs in prod builds.
- Output: hostname (sanitised, lowercase, no path, no query), anchor indicator id, scope,
  UTC day key. **No page URL, no tab title, no site** in the extension store.

### 2. Storage (extension)

- `storage.local` key `alongside.v1`: per candidate host
  `{ days: string[] (≤60), anchors: string[] (indicator ids, ≤8), frameDays, pageDays }`,
  ≤ 500 hosts, LRU eviction, same retention as detections; wiped by "Delete all data".
- Baseline (Decision 3): a bounded day-counter of third-party **registrable domains**
  (`MemoryExposureStore` reused, separate key, ≤ 2000 domains, 60 days). The background
  already computes `clusterDomain()` for every third-party event; this only persists the
  day keys. No sites, no paths.
- **Decision 3 — rank by share, not count:** `alongsideDays / seenDays` for the candidate's
  registrable domain, minimum 2 alongside-days to be listed. "Seen alongside a documented
  host on 3 of the 4 days it was seen at all" is a lead; "4 of 40" is the auction.

### 3. Dashboard tab "Seen alongside"

- New tab after Exposure. Header text (en + nb): _"Hostnames that appeared in the same ad
  frame as a documented host. These are not detections and say nothing about the hosts
  themselves; they are leads for researchers. The list fills slowly: documented hosts are
  rare."_
- Table: hostname · alongside-days / seen-days · documented host(s) · scope · last seen.
  No colour coding, no severity, no verdict words.
- Empty state explains why it is empty (no indicator matches yet), not "all clear".
- New validated `UiRequest` `get_alongside`; read-only.

### 4. Exports

- Hand-off package: section `observations.seenAlongside` (hostname, days, share, anchor ids,
  scope), with the same disclaimer text.
- STIX bundle: each candidate as an `observed-data` SDO + `domain-name` SCO, linked to the
  anchor indicator with a `relationship` of type `related-to`, `description` stating it is an
  observation and not an indicator. **Never** an `indicator` SDO. Validated in the existing
  STIX validator test.
- SIEM export: not included (it is detection-shaped).

### 5. Observatory

- Rig: the harness reads `get_alongside` after each site and stores the delta per row as
  `alongside: [{host, anchor, scope}]`, plus `thirdPartyDomainsList` (the registrable
  domains it already collects in `seenThirdParty`, now kept as a sorted list) for the
  baseline. Synthetic public profiles, public sites: publishing these is in scope.
- `validRunShape`: both fields optional, arrays of strings/objects, length-capped.
- `observatory-build.mjs`: new section "Seen alongside documented hosts" aggregated across
  rigs and days: host, site-days alongside, site-days seen, share, anchors, rigs. Same
  disclaimer; the reading note says how many anchors the period had.
- `refresh-observatory-snapshot.mjs`: not extended in this step (keep the bundled snapshot
  about documented hosts only).

## Invariants and gate

- **Never changes a detection.** Test: run the integration scenarios with and without the
  tracker; detections (ids, severities, counts) are byte-identical. The tracker lives outside
  `detection-engine` and has no write path into it.
- No network, no new permission, CSP unchanged, zero runtime dependencies.
- Privacy test: store and both exports contain only hostnames matching a hostname regex;
  no `/`, `?`, `=`; no page host from the fixture scenarios.
- Tests (positive / negative / false-positive):
  - positive: `staging.synthetic-dsp.test` is itself a synthetic indicator (`syn-0004`), so
    it is excluded by design. Add a non-indicator host, `creative.synthetic-cdn.test`, loaded
    inside the ad frame of the `/selected` scenario (fixture server + e2e host-resolver lists);
    it must be listed alongside the NOAS anchor (Firefox lineage).
  - negative: `/benign` → empty; a heuristic-only detection (redirect chain) → no anchor.
  - false-positive: a mainstream host seen on many days with one co-occurrence → share below
    listing threshold / not ranked; a host in another tab at the same time → not recorded.
- Gate (part 1): the four bullets above pass in unit + integration tests, both e2e browser
  runs list `creative.synthetic-cdn.test`, `opus-reviewer` signs off on the privacy review.

## Work split

1. Shared/relation move + `alongside.ts` + tests (sonnet-builder).
2. Background wiring, storage, `get_alongside`, delete-all (sonnet-builder).
3. Dashboard tab + i18n nb (sonnet-builder).
4. Exports: hand-off + STIX observed-data (sonnet-builder).
5. Rig fields + `validRunShape` + observatory section (sonnet-builder).
6. Review: opus-reviewer on the full diff (privacy and "never a detection").

Steps 1–4 are the extension (release 0.4.0); step 5 can ship to the rig on motor
independently once 1–2 exist.

## Out of scope here

Signed indicator bundles per merge (Phase 10, part 2). Promoting any candidate to an
indicator — that stays a human decision through the indicator review process, with
provenance from a published report.
