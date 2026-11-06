# Phase 8 report — The observatory

Date: 2026-11-05/06. Plan, verification, publishing and this report by Claude Fable 5.1 (main
session); implementation by Sonnet 5.5 builder tasks (A: data library and static site, B:
publish, reproduce, service and docs, C: richer capture, D: parallel daily script and regional
lists, plus one fix batch); adversarial review of the data library, build, publish and reproduce
scripts by Opus 5.5. The plan is `docs/phase-8-plan.md`.

## What was built

| Item                       | State                  | Notes                                                                                                                                                                                                                                                                                       |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public dataset and page    | implemented + verified | `reglund/adtripwire-observatory`, GitHub Pages from `main`: https://reglund.github.io/adtripwire-observatory/. 19 runs over 4 days at first publish. Commits carry the bot identity `AdTripwire observatory <observatory@adtripwire.invalid>` in UTC.                                       |
| Data library               | implemented + verified | `scripts/lib/exposure-runs.mjs`: run loading (date-validated), variant slugs, contacts, host table, run stats, trend Markdown, `scrub` (home path only). `exposure-trend.mjs` is a thin wrapper; its output was diffed before and after (identical apart from the timestamp line).          |
| Static site build          | implemented + verified | `scripts/observatory-build.mjs`: run JSON published verbatim after scrub, evidence and report files, `index.json`, `data/README.md`, root `README.md`, `index.html` with inline CSS, no JavaScript, every value escaped, raw HTML only via a private class, calendar capped at 400 days.    |
| Publish script             | implemented + verified | `scripts/observatory-publish.sh`: off unless `ADTRIPWIRE_OBSERVATORY_REMOTE` is set; validated remote; never runs git in the checkout; refuses a branch whose root lacks `index.html`; commits only on change; 7 bare-repo tests including identity and UTC.                                |
| Reproduce                  | implemented + verified | `pnpm observatory:reproduce -- --date --variant [--limit --seconds --from]`: builds the eval bundle in a temp dir, fresh profile, compares with the published row (see Gate 8).                                                                                                             |
| Richer capture             | implemented + verified | Every detection keeps id, timestamp, confidence, subject hostnames, matched indicator ids, occurrence count, summary and evidence strings; each run with detections writes the extension's evidence export (default profile) as `<run>.evidence.json`. Smoke run: 33 detections, 33 events. |
| Daily service              | implemented + verified | `scripts/exposure-daily.sh`: eight variants two at a time (desktop Firefox and Chromium, iPhone 15 and Pixel 5 emulation, Norway list and Middle East/Africa list each on desktop and Pixel), per-variant logs, trend, build, publish; unit installed 2026-11-05 22:30, next run 11:45.     |
| Regional site lists        | implemented            | `tests/fixtures/norway.txt` (24 sites), `tests/fixtures/mena-africa.txt` (25 sites). First real runs on 2026-11-06.                                                                                                                                                                         |
| Docs                       | implemented            | `docs/observatory.md`, `docs/exposure-session.md`, CHANGELOG, roadmap; `docs/phase-8b-plan.md` for many rigs.                                                                                                                                                                               |
| Found and fixed on the way | implemented + verified | Dashboard evidence-export button saved the `{ filename, json }` wrapper instead of the export. Firefox snap 159 (auto-refresh 2026-11-05 18:10) needs `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`; the harness sets it (that is why the 2026-11-05 Firefox variant has no row).                      |

## Decisions taken with the user

- **Publish everything.** The profiles are synthetic and the machine is a measurement rig, so
  the run JSON, reports and evidence exports are published in full. Only the home path is
  scrubbed. This is not a privacy measure; it keeps the rig slightly less recognisable.
- **A separate public repository** for the dataset rather than opening the code repository:
  Pages on the free plan, daily data commits out of the code history, a repo-scoped deploy key,
  a citable name.
- **Scale by vantage points, not speed**: two regional lists and two-at-a-time variants now;
  many rigs as Phase 8b.

## Verification

| Check                                | Result                                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit + integration tests             | 727 passed (51 files), incl. 24 observatory tests and 7 publish-script tests against bare repositories                                                                                         |
| Typecheck, eslint, prettier          | clean                                                                                                                                                                                          |
| Trend equivalence                    | before/after diff identical except the "Generated" line                                                                                                                                        |
| Site in a browser                    | light, dark and 390 px screenshots reviewed; zero non-file requests; no horizontal scroll                                                                                                      |
| Published output grep                | no home path, login name, machine hostname, LAN or loopback addresses (Opus review); no safe/clean/infected/spied                                                                              |
| Opus review                          | "ship after fixes": 1 high (commit identity), 4 medium, 5 low; all fixed, incl. stale-file cleanup, scrub scope, service exit status, wording "persistent profiles", raw-HTML marker, date cap |
| Firefox e2e after the snap update    | all PASS; harness fixed and smoke-run on one site                                                                                                                                              |
| Daily script                         | stub test: at most P concurrent, all eight names, trend status propagated, build/publish failure masked                                                                                        |
| Publish from the service environment | `ssh -T git@github.com` succeeds under `systemd-run --user` (keyring agent); first publish and the 2026-11-05 republish done by the script                                                     |

## Gate 8

- Page produced only from harness output: met (`build` reads one directory and writes one).
- No field identifies a person or device: Opus audit of the real site, plus the identity fix.
  Known remaining identification: site list and schedule reveal the rig as such; accepted.
- A day's row reproduces within the stated tolerance: met on 2026-11-06 06:10 for `2026-11-05 / chromium` with `--limit=5 --seconds=30`: site list identical (5 of 5), loaded 5 vs 5, median third-party domains 33 vs 51 (within a factor of two), no documented hosts on either side; verdict "within tolerance", exit 0. A full 50-site reproduction takes about an hour and is the reader's option.
- Legend passes the conservative-language rule: met (forbidden-word test on the rendered page
  and reading).

## Known limitations

- One rig, one residential IP in Norway; contacts seen so far are tracking hosts at
  suspicious severity, as expected for a generic profile. Three days is noise.
- Reproduction compares a fresh profile with a warmed one; medians differ by consent state, so
  the tolerance is a factor of two and documented hosts carry no pass/fail.
- Publishing trusts the deploy key: a compromised rig can push anything to the dataset
  repository (never to the code repository once the repo-scoped key is in use).
- Firefox variants depend on a BiDi system-access switch that Mozilla has already moved once.
