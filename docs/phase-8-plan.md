# Phase 8 plan — The observatory

Written 2026-11-05 by Claude Fable 5.1 (main session) from the roadmap, the daily service and
the run JSON in `~/.cache/adtripwire-exposure/`. Three builder tasks: A (data + static site),
B (publish, reproduce, service, docs) run in parallel; C (richer capture in the run script)
runs after tonight's exposure run has finished, because the service starts each variant from
the file on disk.

## Goal

Every evening the timer turns its run output into a static site: which sites and which
browser or device variants put a generic visitor in contact with documented infrastructure,
day by day, since 2026-11-02. The site is built only from harness output and the extension is
untouched. Anyone can reproduce a day's row from a clean checkout with one command.

## Decisions

1. **Publish everything the run produces.** The profiles are synthetic and the machine is a
   measurement rig, so the per-run JSON is published verbatim, plus `trend.md` and the
   per-run Markdown reports. The only thing removed is what identifies the rig itself: a
   `scrub()` step replaces the home directory and the login name wherever they appear in a
   string (error messages, paths). This is not a privacy measure; it keeps the rig slightly less
   recognisable and keeps the dataset about publishers and ad infrastructure.
2. **Capture more, not less** (task C): every detection keeps its subject hostnames regardless
   of severity, plus `timestamp`, `confidence`, `matchedIndicatorIds`, `occurrenceCount`,
   `evidence[].observed` and `summary`. Each run also writes the extension's evidence export
   (`export_evidence`, default profile) next to the JSON as `<date>-<variant>.evidence.json`.
3. **Static, dependency-free site.** `index.html` is generated at build time with inline CSS and
   no JavaScript; every value goes through one `esc()` helper. JSON and Markdown are served as
   files next to it. No analytics, no external resources.
4. **Publishing is configured outside the repository** and is off by default: the service reads
   `~/.config/adtripwire/observatory.env` (`ADTRIPWIRE_OBSERVATORY_REMOTE`, optional
   `ADTRIPWIRE_OBSERVATORY_BRANCH`, default `observatory`). The repository is private and GitHub
   Pages is not enabled, so the publish target (a public repository or this one made public)
   is the user's decision; the build and the publish script work regardless.
5. **Reproduction tolerance.** Auctions are stochastic, so a reproduced day is compared on what
   is deterministic: identical site list and variant; loaded sites within 10 % of the published
   count; median third-party domains within a factor of two either way; documented hosts reported as shared / only in
   the published run / only now, without a pass/fail on them.
6. **No new site lists in this phase.** The four daily variants already take 5–6 h of an 8 h
   budget. Extra lists run on demand with `--sites=` and appear as their own variant (as the
   Yandex list did on 2026-11-02); adding them to the timer is a later decision.
7. **Wording.** The legend repeats, on every section that shows contacts, that contact is
   exposure to an ad-delivery path and not evidence of targeting or of anything reaching a
   device. No "safe", "clean", "infected", "spied".

## Task A — data library and static site (sonnet-builder)

Files: new `scripts/lib/exposure-runs.mjs`, new `scripts/observatory-build.mjs`,
`scripts/exposure-trend.mjs` (import from the library; output byte-identical), new
`tests/integration/observatory.test.ts`.

1. `scripts/lib/exposure-runs.mjs` exports: `SEV`, `NOISY_RULES`, `variantOf(run)`,
   `variantSlug(run)` (`chromium`, `chromium-pixel-5`, `firefox-etp-off-yandex-ad-sites`, …),
   `loadRuns(dir)` (same filter and sort as the trend script today), `contactsOf(runs)`,
   `hostTable(contacts)`, `runStats(run)` (loaded, consent, requests, median, bySev, noisy) and
   `scrub(value, { home, user })` (deep copy; replaces `home` and `/home/<user>` and the bare
   user name as a path segment in every string). The trend script must keep producing the
   same `trend.md`: run it before and after on `~/.cache/adtripwire-exposure` and diff.
2. `scripts/observatory-build.mjs [--dir=~/.cache/adtripwire-exposure] [--out=<dir>/site]`:
   - writes `data/runs/<date>-<slug>.json` (scrubbed verbatim run JSON),
     `data/runs/<date>-<slug>.evidence.json` when present, `data/reports/<date>-<slug>.md`
     when present, `data/trend.md`, `data/index.json` (`{ schemaVersion: 1, generatedAt,
period, runs: [{ file, date, variant, slug, browser, device, etpOff, siteList, sites,
loaded, contacts, strong }], hosts: [...hostTable], contacts: [...] }`) and
     `data/README.md` describing every field of a run file (from the run script's row shape)
     and of `index.json`.
   - writes `index.html`: header with period and run count; "What this is" (synthetic
     profiles, which browsers and devices, 60 s per site, consent accepted, one article; nothing
     here is about a person); the legend; **Documented hosts over time** (one row per host, one
     cell per day in the period: contact / run without contact / no run, plus variants and
     sites); **Signals that matter**; **Sites that carried documented hosts** (site, hosts,
     days, variants); **Browsers and devices side by side** (per variant: days run, mean loaded,
     mean median third-party domains, contacts, distinct hosts); **Runs** (the trend table);
     **Reproduce a day** (the exact command from task B); **Data** (links to every file);
     **Method and limitations** (copied from the trend's "Reading this"). Inline CSS, light and
     dark via `prefers-color-scheme`, readable at phone width, no JavaScript.
   - Exports `buildIndex`, `renderHtml`, `scrub` for tests; runs `main()` only when executed
     directly.
3. Tests (`tests/integration/observatory.test.ts`, vitest, node environment, temp dirs):
   `loadRuns` skips malformed files; `variantSlug` cases; `scrub` removes the home path and
   user name from nested strings and leaves numbers alone; `renderHtml` escapes `<` and `&` in
   site names and hostnames; rendered HTML contains none of the forbidden words (regex, word
   boundary, case-insensitive: safe, clean, infected, spied); `buildIndex` counts contacts and
   strong per run; building into a temp dir writes every expected file.
4. `pnpm lint && pnpm test`, then build the real site into
   `~/.cache/adtripwire-exposure/site` and report the file list and sizes.

## Task B — publish, reproduce, service, docs (sonnet-builder)

Files: new `scripts/observatory-publish.sh`, new `scripts/observatory-reproduce.mjs`,
`scripts/systemd/adtripwire-exposure.service`, `scripts/install-exposure-timer.sh`,
`package.json` (scripts), new `docs/observatory.md`, `docs/exposure-session.md` (pointer),
`CHANGELOG.md` (Unreleased / Added).

1. `scripts/observatory-publish.sh <site-dir>`: `set -eu`; if
   `ADTRIPWIRE_OBSERVATORY_REMOTE` is unset, print "observatory: publishing is not configured
   (see docs/observatory.md)" and exit 0. Otherwise: temp dir; `git clone --depth 1
--branch "$branch" "$remote" tmp` or, when the branch does not exist, `git init` + `git
checkout --orphan "$branch"` with the remote added; replace the clone's content with the
   site (`rsync -a --delete --exclude .git`, or `find`+`cp` if rsync is missing), add
   `.nojekyll`, commit `observatory <date>` only when `git status --porcelain` is non-empty,
   push. Never touches the repository working tree. Exit non-zero on push failure (the service
   wraps it in `|| true`).
2. `scripts/observatory-reproduce.mjs --date=YYYY-MM-DD --variant=<slug> [--from=<site dir or
https URL>] [--seconds=60] [--limit=N] [--keep]`: resolves the variant slug to the
   `exposure-run.mjs` flags (browser, `--device`, `--etp-off`, `--sites`); builds the evaluation
   bundle into a temp dir with `node apps/extension-<browser>/build.mjs --eval --out=<tmp>`;
   runs `scripts/exposure-run.mjs` with a fresh temp profile and `--json=<tmp>/run.json`;
   loads the published run from `<from>/data/runs/<date>-<slug>.json` (file or `fetch`, add
   `/* global fetch */`); prints a comparison table (site list identical?, loaded, median
   third-party domains, documented hosts shared / only published / only now) and the verdict
   "within tolerance" or "outside tolerance" per decision 5; exit 0 or 1. `--limit` trims
   both sides to the first N sites so a quick check is possible. Temp dirs removed unless
   `--keep`.
3. Service unit: `EnvironmentFile=-%h/.config/adtripwire/observatory.env`; after the trend
   step append `node scripts/observatory-build.mjs --dir=$$c --out=$$c/site && sh
scripts/observatory-publish.sh $$c/site || true`. Update the comment. The install script
   is unchanged in behaviour but prints where to configure publishing.
4. `package.json`: `observatory:build`, `observatory:publish`, `observatory:reproduce`.
5. `docs/observatory.md`: what is published and why it is safe to publish (decision 1), the
   file layout, configuring the remote (env file example, GitHub Pages from the
   `observatory` branch of a public repository), reproduction and its tolerance, the wording
   rule. `docs/exposure-session.md`: one paragraph pointing there. CHANGELOG bullet.
6. `pnpm lint` (shell script: `sh -n`), and a dry run of the publish script against a local
   bare repository in a temp dir (`git init --bare`) proving the branch is created, the site
   lands at its root, and a second run with no changes makes no commit.

## Task C — richer capture (after tonight's run; sonnet-builder)

File: `scripts/exposure-run.mjs`. Per detection keep `detectionId`, `timestamp`,
`confidence`, `hostnames` (always `subjectHostnames`), `matchedIndicatorIds`,
`occurrenceCount`, `summary`, `evidence` (the `observed` strings). After the loop, when
`--json` is set, request `{ type: "export_evidence", profile: "default" }` and write its
`text` to `<json path without .json>.evidence.json`. The Markdown report keeps its current
columns. Task A's `data/README.md` is updated for the new fields.

## Review and gate (main session + opus-reviewer)

- Opus reviews the library, the build script and the publish script: can any published field
  identify a person or the device beyond what the site list already reveals; is the HTML
  escaping complete; can the publish script ever touch the repository checkout; wording.
- Gate 8: site produced only from harness output (build reads the cache dir and nothing
  else); reviewer confirmation on the fields; one reproduced row within tolerance
  (`--limit=5` for the verification run, full run documented as the user's option); legend
  checked by the forbidden-word test and by reading.
- `docs/phase-8-report.md`; roadmap entry updated.
