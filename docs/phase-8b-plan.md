# Phase 8b plan — Many rigs, one observatory

Written 2026-11-05 by Claude Fable 5.1 (main session) after the user chose to scale the
observatory by vantage points rather than by speed. Status: planned, not started. Phase 8
(single rig, parallel variants, two regional lists) ships first.

## Why

Contact with documented infrastructure depends on where the browser is (country, network,
residential or datacentre IP), what it looks like (desktop, phone) and which sites it visits.
One Norwegian home connection is one vantage point. Friends running the same harness on their
own home or mobile connections, in other countries, multiply what the observatory can see.
Datacentre VPSes are not worth it: ad exchanges filter their IP ranges and show little or no
programmatic inventory.

## What a rig is

A machine that runs the daily timer with its own persistent profiles and publishes its runs
under its own name. Requirements: Linux with snap Firefox and Chromium (or the paths set by
env), Node 20 and pnpm, a clone of AdTripwire, `sh scripts/install-exposure-timer.sh`, a
deploy key for the observatory repository, and an `observatory.env` with a rig name.

## Design

1. **Rig name.** `ADTRIPWIRE_RIG` (env file; default `rig-1`), validated `[a-z0-9-]{1,32}`.
   `exposure-run.mjs --rig=<name>` writes it as `rig` in the run JSON. The daily script passes
   it. Older runs without the field are treated as `rig-1`. The rig name is chosen by the rig
   owner and should not be a hostname or a person's name; the docs say so.
2. **Country and network class, self-declared.** `ADTRIPWIRE_RIG_COUNTRY` (ISO 3166-1
   alpha-2) and `ADTRIPWIRE_RIG_NETWORK` (`home`, `mobile`, `office`, `datacentre`) go into the
   run JSON as `rigCountry` and `rigNetwork`. No IP is ever recorded; the declaration is what
   makes the published rows comparable.
3. **Publishing layout.** The site branch gets `rigs/<rig>/runs/<date>-<slug>.json`,
   `rigs/<rig>/runs/*.evidence.json` and `rigs/<rig>/reports/*.md`. The publish script takes a
   `--rig` mode: clone the branch, replace only `rigs/<rig>/` (rsync `--delete` scoped to that
   directory), commit as the bot identity with the rig name in the message, push. A non-primary
   rig never writes outside its directory; the script refuses to run in `--rig` mode without a
   rig name.
4. **Aggregation on the primary rig.** The primary rig (the user's) is the only one that
   builds `index.html` and `data/`. Its daily script first pulls the branch, then runs the
   build over its own cache plus every `rigs/*/runs/*.json`, then publishes the root (`index.html`,
   `data/`, `README.md`) while leaving `rigs/` untouched. No CI and no secrets in the public
   repository. If the primary rig is down, other rigs still publish their rows; the page catches
   up at the next primary run.
5. **Build changes.** `loadRuns` accepts several directories and keeps `rig` on each run;
   variant slugs gain a rig prefix only in file names under `data/runs/` (`<date>-<rig>-<slug>.json`).
   The page gets a **Rigs** table (rig, country, network, days run, variants, contacts, hosts) and
   a rig column in "Signals that matter" and "Documented hosts over time"; the side-by-side table
   can be filtered per rig with plain anchors (one section per rig, no JavaScript).
6. **Trust model.** Every rig has a deploy key with write access to the whole branch; the
   per-directory discipline is in the script, not enforced by GitHub. Rigs are therefore people
   the user knows. The primary rig's build validates every foreign run file with the same
   schema check as its own (`loadRuns` drops malformed files) and scrubs home paths again. A rig
   that misbehaves is removed by deleting its key and its directory.
7. **Reproduction** gains `--rig=<name>` so a row from any rig can be re-run from any machine;
   the comparison notes that a different vantage point is expected to differ.
8. **Onboarding doc** `docs/rig-setup.md`: ten steps, one screen, from clone to the first
   published row, plus what the rig owner's machine sends (run JSON, nothing else) and how to
   stop.

## Not in 8b

- Real browsers of real people (the extension in friends' daily browsing): that is personal
  data and needs an opt-in export flow with the sanitised evidence profile; a later phase.
- Any server-side component, CI in the public repository, or a shared secret.

## Tasks (when started)

- A (sonnet-builder): rig fields in `exposure-run.mjs`, daily script, env, validation, tests.
- B (sonnet-builder): publish script `--rig` mode and primary aggregation (pull, build over
  `rigs/*`, publish root only), with the bare-repo tests extended for two rigs.
- C (sonnet-builder): build and page changes, `docs/rig-setup.md`, `docs/observatory.md`.
- Review (opus-reviewer): trust model, path scoping of the publish script, scrub of foreign
  files, wording.

## Gate 8b

A second rig on another machine (or a second user account on this one with its own key)
publishes a day; the primary rig's next run shows both rigs on the page; the second rig's key
cannot be used to change the root (verified by the script's refusal, with the GitHub-side
limitation stated in the docs); `docs/rig-setup.md` followed by a person who has not seen the
repository produces a published row.

## Interfaces (fixed 2026-11-06 before implementation; every task codes against these)

Environment (`~/.config/adtripwire/observatory.env`, read by the service):

- `ADTRIPWIRE_RIG` rig name, `^[a-z0-9][a-z0-9-]{0,31}$`, default `rig-1`; required when
  `ADTRIPWIRE_OBSERVATORY_REMOTE` is set (else the observatory steps are skipped).
- `ADTRIPWIRE_RIG_COUNTRY` ISO 3166-1 alpha-2, upper case, optional.
- `ADTRIPWIRE_RIG_NETWORK` one of `home`, `mobile`, `office`, `datacentre`, optional.
- `ADTRIPWIRE_OBSERVATORY_ROLE` `rig` (default) or `primary` (explicit only).

Run JSON gains `rig`, `rigCountry`, `rigNetwork` (the last two only when given) from
`exposure-run.mjs --rig=<name> [--rig-country=XX] [--rig-network=home]`.

Scripts:

- `node scripts/observatory-export-rig.mjs --dir=<cache> --out=<dir> --rig=<name>
[--country=XX] [--network=home]`: empties `<out>`, writes scrubbed copies of every run JSON
  (adding `rig` when missing), evidence files and reports as `runs/<date>-<slug>.json`,
  `runs/<date>-<slug>.evidence.json`, `reports/<date>-<slug>.md`, plus `rig.json`
  `{ rig, country?, network?, exportedAt, runs }`. Slugs from the library.
- `sh scripts/observatory-publish.sh --rig <name> <export-dir>`: replaces only
  `rigs/<name>/` on the branch. `sh scripts/observatory-publish.sh <site-dir>` (root mode):
  replaces everything except `rigs/` and `.git`. Root mode is refused when the branch root has
  content other than `index.html`-sites, `rigs/`, `.nojekyll`, `README.md` (a code branch).
  Both modes retry a rejected push up to three times by re-cloning and re-applying. Bot
  identity and UTC as today; message `observatory <date>` or `observatory rig <name> <date>`.
- `sh scripts/observatory-sync.sh <dir>`: clones the branch into `<dir>` (or fetches and
  resets when `<dir>/.git` exists); exit 0 with an empty `<dir>/rigs` when the branch does not
  exist yet.
- `node scripts/observatory-build.mjs --dir=<cache> --out=<site> [--rig=<name>]`
  (single rig, as today, runs attributed to `--rig` or `rig-1`) or
  `--rigs=<sync-dir>/rigs --out=<site>` (many rigs: loads `rigs/*/runs/*.json`, `rig` is always the
  directory name (what the rig's key wrote to; the JSON cannot claim another rig), evidence and reports from the same rig directory). Site files
  are always `data/runs/<date>-<rig>-<slug>.json` etc. `index.json` gains `rigs: [{ rig,
country, network, days, runs, variants, contacts, hosts }]` and `rig` on each run.
- `node scripts/observatory-reproduce.mjs ... [--rig=<name>]`: picks the row by rig; when
  `index.json` lists exactly one rig, `--rig` may be omitted.
- `scripts/exposure-daily.sh`, after the trend step (its status is still the script's):
  role `rig`: export-rig → publish `--rig`. Role `primary`: export-rig → publish `--rig` →
  sync into `$c/remote` → build `--rigs=$c/remote/rigs` → publish root. Each step best-effort.

Page: a **Rigs** table before the variants table; a rig column in "Signals that matter",
"Documented hosts over time" and "Sites that carried documented hosts"; the side-by-side table
grouped per rig. Wording unchanged. `docs/rig-setup.md` is the onboarding page for a rig owner.
