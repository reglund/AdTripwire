# Plan — The observatory inside the extension (bundled snapshot)

Written 2026-11-06 by Claude Fable 5.1 (main session). Follows Phase 8/8b; not a roadmap phase
of its own (it is the first half of Phase 10, "fresh eyes": public measurement feeding back into
what the extension can say). Implemented by one Sonnet 5.5 builder task.

## Goal

When the Exposure view shows a contact with a documented host, it can also say what the public
observatory saw for that host: on how many measured days, last when, on which mainstream sites,
by generic automated profiles. That is the strongest support the extension can give for
"exposure, not targeting", and it needs no network: the observatory's host table is bundled at
build time like the indicator set and refreshed per release.

## Invariants kept

- No network from the extension (`connect-src 'none'`): the data is a JSON file in the bundle.
- No verdict wording. "Seen by the observatory" is an observation; "not seen" says nothing.
- Zero runtime dependencies; the file is small (hosts ≤ 500, sites per host ≤ 10).
- The snapshot is public data about synthetic profiles; it contains no user data.

## Pieces

1. **Data** `packages/correlation/data/observatory-snapshot.json`:
   `{ schemaVersion: 1, source: "<index.json URL>", generatedAt, period: { from, to, days },
rigs: number, runs: number, hosts: [{ host, first, last, days, runs, sites: string[≤10],
variants: number, rigs: number }] }`. Generated, never edited by hand. The first snapshot is
   generated from the live page today.
2. **Refresh script** `scripts/refresh-observatory-snapshot.mjs [--from=<url|dir>] [--check]`:
   reads `data/index.json` (default `https://reglund.github.io/adtripwire-observatory/data/index.json`;
   a local site directory works too), validates every field (hostnames, dates, integers),
   caps sizes, writes the snapshot sorted by host; `--check` compares only (exit 1 on drift).
   A validator function `validateObservatorySnapshot(json)` lives in `packages/correlation`
   and is used by the script and by a test on the bundled file.
3. **Lookup and wording** `packages/correlation/src/observatory.ts`: `observatoryLookup(host)`
   (exact host, then registrable-domain parent via the same boundary rule the matcher uses:
   `tracookiepixel.xyz` matches `a.tracookiepixel.xyz`), `observatorySummary()` (period, rigs,
   runs), and `observatoryText(entry | null, period)` returning two sentences in English with
   `t()`-ready placeholders handled in the UI (the UI owns translation; the library returns
   structured values, not prose).
4. **UI** `packages/extension-core/src/ui/views/exposure.ts` contact card: after the meaning
   paragraph, a `p.observatory-note` with either
   "The public observatory saw this host on {days} of {total} measured days (last {date}), on
   {sites}, in generic automated profiles. Contact with it is common exposure." or
   "The public observatory has not seen this host in {total} measured days. That says nothing
   either way: the observatory is small and its site list is fixed." plus an external link
   "Observatory" to the page. Snapshot date shown once at the top of the view in muted text:
   "Observatory data as of {date}". Bokmål entries for every new string.
5. **Docs and tests**: `docs/privacy.md` (bundled public dataset, no network), UI README,
   `docs/observatory.md` (refresh step before a release, `pnpm observatory:snapshot`),
   `docs/release.md` (add the refresh to the release checklist), CHANGELOG. Tests: lookup
   (exact, parent domain, miss), validator (rejects bad hostnames, dates, oversize), text
   values, wording test on the UI strings (no safe/clean/infected/spied), i18n coverage.
   Build guard: the snapshot must not contain reserved TLDs (`.test`, `.invalid`); add that to
   the validator.

## Not in scope

Fetching the snapshot at runtime (would break `connect-src 'none'`), per-user comparison
("you vs. the observatory") beyond the per-host note, and the popup.
