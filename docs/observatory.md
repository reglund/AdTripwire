# The observatory

A static site, rebuilt after each daily exposure run, that shows which sites and which browser
or device variants put a generic visitor in contact with infrastructure documented in the
AdFection reporting, day by day. It is built only from the output of the exposure harness
(`scripts/exposure-run.mjs`); the extension itself is not involved and sends nothing.

## What is published, and why

**The data comes from synthetic browser profiles on a measurement machine.** Each run uses a
purpose-made profile that persists across days (no personal browsing, no logins) and visits a public list of mainstream
sites, accepts the consent dialog, scrolls, opens one article and stays 60 seconds per site.
Nothing in the data describes a person.

**Everything the run produces is published in full**: the per-run JSON as written by the run
script, the cumulative `trend.md`, the per-run Markdown reports and, when present, the
extension's evidence export. The only thing removed is what identifies the measurement machine
itself: the machine's home directory, and `/home/<login name>`, are replaced by `~` wherever they
appear in a string (error messages, paths). A bare user name is not touched, so URL paths in
evidence stay as observed. This is not a privacy measure for a user, because there is no
user in this data. It keeps the rig slightly less recognisable and keeps the dataset about
publishers and ad infrastructure, which is what it is for. Publishing the full row, rather than
a summary, is what lets anyone check the conclusions and run the same visit themselves.

Contact with documented infrastructure means the browser was exposed to an ad-delivery path
described in public reporting. It is not evidence of targeting, and not evidence that anything
reached a device. No contact in a run says only that none was observed in that run: ad
selection happens server-side and varies from visit to visit.

## File layout

The build writes one directory (by default `~/.cache/adtripwire-exposure/site`):

```text
index.html                         the page: no JavaScript, inline CSS, no external resources
.nojekyll                          added by the publish step
data/index.json                    machine-readable summary: runs, documented hosts, contacts
data/trend.md                      the cumulative trend report
data/README.md                     every field of a run file and of index.json
data/runs/<date>-<rig>-<slug>.json       the run, as written by the harness (scrubbed)
data/runs/<date>-<rig>-<slug>.evidence.json   the extension's evidence export, when present
data/reports/<date>-<rig>-<slug>.md      the per-run Markdown report, when present
```

The slug names the variant: the browser (`chromium`, `firefox`), then `-<device>` for an
emulated phone (`iphone-15`, `pixel-5`), then `-etp-off` when Firefox Enhanced Tracking
Protection was disabled, then `-<site list>` when the list is not `exposure-sites.txt` (for
example `firefox-etp-off-yandex-ad-sites`).

### Variants

`scripts/exposure-daily.sh` runs eight variants each day, two at a time. Published slugs:

- `firefox`, `chromium`, `chromium-iphone-15`, `chromium-pixel-5`: the default list,
  `exposure-sites.txt` (the ad-heaviest mainstream sites).
- `chromium-norway`, `chromium-pixel-5-norway`: the Norway list,
  `norway.txt`, a "normal day in Norway" of national and regional news, business
  and consumer sites with programmatic ad slots.
- `chromium-mena-africa`, `chromium-pixel-5-mena-africa`: the
  Middle East and Africa list, `mena-africa.txt`, mainstream publishers in the
  markets the AdFection reporting names; from a European vantage point lower exposure is
  expected than in-region, and the list exists so in-region rigs can run the same visits.

Build by hand with `pnpm observatory:build [--dir=<run output dir>] [--out=<site dir>]`.

## Publishing

Publishing is off by default and configured outside the repository. The systemd unit reads
`~/.config/adtripwire/observatory.env`:

```sh
# ~/.config/adtripwire/observatory.env
ADTRIPWIRE_OBSERVATORY_REMOTE=git@github.com:<owner>/<repository>.git
# optional, default is "observatory"
ADTRIPWIRE_OBSERVATORY_BRANCH=observatory
```

After the trend step, the unit builds the site and runs `scripts/observatory-publish.sh`. With no
remote configured the script prints "publishing is not configured" and exits 0. With one, it
clones the branch (or creates it as an orphan branch) into a scratch directory, replaces the
content with the site, adds `.nojekyll`, commits `observatory <date>` only when something
changed, and pushes. Commits are always authored as
`AdTripwire observatory <observatory@adtripwire.invalid>` with a UTC timestamp, whatever the
global git configuration says. The remote must be a URL (`scheme://...` or `user@host:path`) or an
absolute path; it is never printed, because it may embed a token. An existing branch is
overwritten only when its root is empty or already holds an `index.html`, so the main branch of a
code repository cannot be replaced (exit 2). It never runs git inside the AdTripwire checkout.
A failing build or publish does not fail the unit: the unit's status is that of the trend step.

Run it by hand with `pnpm observatory:publish <site-dir>`.

Which repository receives the site is a decision for the owner: the AdTripwire repository is
private, so GitHub Pages needs either a separate public repository for the site or this one made
public. For GitHub Pages, choose Settings, Pages, "Deploy from a branch", branch `observatory`,
folder `/ (root)`.

## Many rigs

Contact with documented infrastructure depends on where the browser is. Several machines
(rigs) can therefore contribute runs; each has a name (`^[a-z0-9][a-z0-9-]{0,31}$`, default
`rig-1`), and may declare a country (ISO 3166-1 alpha-2) and a network class (`home`, `mobile`,
`office`, `datacentre`). Both declarations come from the rig owner and are not verified; no
address is recorded. Onboarding a rig is described in `docs/rig-setup.md`.

Layout on the publishing branch:

```text
index.html, data/, README.md, .nojekyll      the page and its data (written by the primary rig only)
rigs/<name>/runs/<date>-<slug>.json          a rig's runs, scrubbed
rigs/<name>/runs/<date>-<slug>.evidence.json optional evidence export
rigs/<name>/reports/<date>-<slug>.md         optional per-run report
rigs/<name>/rig.json                         { rig, country?, network?, exportedAt, runs }
```

Roles (`ADTRIPWIRE_OBSERVATORY_ROLE` in `observatory.env`): a `rig` (the default) exports its
own runs and replaces only `rigs/<name>/` on the branch. The `primary` (set explicitly, never
the default; the maintainer's machine) does the same for its own rig, then pulls the branch, builds the page over every
`rigs/*/runs/*.json` with `node scripts/observatory-build.mjs --rigs=<checkout>/rigs --out=<site>`
and publishes the root, leaving `rigs/` untouched. If the primary is down, the other rigs still
publish their rows and the page catches up at the next primary run. With a remote configured,
`ADTRIPWIRE_RIG` must be set too; otherwise the daily run measures but skips every observatory
step. In `--rigs` mode the directory name is always the rig (a run's own `rig` field is
ignored); directories whose name is not a valid rig name are skipped, malformed run files are
dropped as in single mode, home paths are scrubbed again, only real directories and regular
files are read (never a symbolic link), files over 5 MB are skipped, at most 2000 runs per rig
are used (the newest), and runs dated before 2026-01-01 or after tomorrow are dropped. The
build prints how many entries it skipped.

Single-machine builds stay as before: `node scripts/observatory-build.mjs --dir=<cache>
[--rig=<name>]` attributes every run without a `rig` field to `--rig` (default `rig-1`).

Naming: files in `data/` are always `data/runs/<date>-<rig>-<slug>.json` (and `.evidence.json`,
`data/reports/<date>-<rig>-<slug>.md`), whatever the mode. `index.json` has a `rigs[]` summary
and `rig` on every run and contact; the page has a Rigs table and a rig column wherever runs,
contacts or hosts are listed. Sites built before rigs existed use `<date>-<slug>`.

Running a rig in a container on a home server (Docker image, compose file, host timer, and how to
move the history from a laptop): `docs/rig-docker.md`.

Trust: every rig's deploy key can write the whole branch. Rigs are people the maintainer
knows; see `docs/rig-setup.md`.

## Reproducing a day

From a fresh checkout (`pnpm install` first):

```sh
pnpm observatory:reproduce -- --date=2026-11-04 --variant=chromium-pixel-5 --rig=rig-1 \
  --from=https://<owner>.github.io/<repository>
```

`--from` is a site directory or an `https://` URL of the published site (other schemes are refused; default
`~/.cache/adtripwire-exposure/site`). The script resolves the slug to the flags of
`scripts/exposure-run.mjs`, builds the evaluation bundle for that browser into a scratch
directory, runs the same site list with a fresh profile, and compares the result with the
published `data/runs/<date>-<rig>-<slug>.json`. `--rig` may be left out when the site's
`data/index.json` lists exactly one rig; with several it is required (exit 2 otherwise). A site
built before rigs existed is still found by its `<date>-<slug>` file name. A different rig
sits on a different network, so differences from its published row are expected. Options: `--seconds=60`, `--limit=N` (both sides are
trimmed to the first N sites for a quick check), `--keep` (keep the scratch directory),
`--dry-run` (print the commands and stop). A full run takes about the site count times the
dwell time, so one variant is roughly an hour and a half.

Ad auctions are stochastic, so only what is deterministic is held to a tolerance:

- the site list is identical (same sites, same order);
- loaded sites are within 10 % of the published count, never stricter than one site (the
  allowance is `max(1, round(0.1 * published))`);
- the median number of third-party domains is within a factor of two of the published median, either way (a fresh profile accepts consent again and sees more auctions than a warmed one);
- documented hosts are listed as shared, only in the published run, and only in the new run,
  with no pass or fail: whether a particular host appears on a particular day is exactly what
  varies.

The verdict is "within tolerance" (exit 0) or "outside tolerance" (exit 1). Errors exit 2.

## Notifications

The primary rig (`ADTRIPWIRE_OBSERVATORY_ROLE=primary`) ends each daily run by comparing the
site it just built with what it last told you: `node scripts/observatory-notify.mjs
--index=<cache>/site/data/index.json --state=<cache>/notify-state.json` (`pnpm
observatory:notify`). Other rigs do not send notifications. The step runs after the root
publish whether or not the publish worked, and never changes the script's exit status.

The text has one line per change and a closing summary:

```
New documented host: <host>, first seen <date> on <site> (<rig>, <variant>)
New site carrying <host>: <site> (<rig>, <variant>, <date>)
Elevated or above: <ruleId> [<severity>] on <site> (<rig>, <variant>, <date>)
Observatory <date>: <n> run(s), <n> contact(s), <n> documented host(s), <n> rig(s)
```

A contact is exposure to a documented ad-delivery path; the lines say no more than that. The
first run, with no state file yet, records the current index and sends only the summary and
"Notification state initialised; future runs report changes only." The history is not replayed.

| Variable                     | Effect                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADTRIPWIRE_NOTIFY_CMD`      | Shell command run with `sh -c`; the text arrives on its standard input and is never part of the command line. Unset: nothing is sent, the log is still written. |
| `ADTRIPWIRE_NOTIFY_ALWAYS=1` | Send the summary even when nothing changed (`--always`). Without it a day with only the summary line sends nothing.                                             |

Examples (in the environment of the timer, e.g. a drop-in for the service):

```
ADTRIPWIRE_NOTIFY_CMD='mail -s "AdTripwire observatory" you@example.org'
ADTRIPWIRE_NOTIFY_CMD='curl -s -d @- https://ntfy.sh/<topic>'
```

Only the message text is sent: no run files, evidence, reports or paths. Every delivered text
is also appended, with a UTC timestamp, to `notifications.log` next to the state file. The state
is saved (as a whole file, temp file then rename) only after the command succeeded, so a failed
delivery is retried at the next run; the log then marks the attempt "(delivery failed)". `--dry-run`
prints the text and writes and runs nothing. The exit status is 0, or 2 when the index cannot
be read. Anything you send to a public topic such as ntfy.sh is public: choose a topic name
nobody can guess, or use a channel you control.

## Refreshing the bundled snapshot

The extension ships a small copy of the observatory's host table so the Exposure view can say
what the public observatory saw for a documented host without any network request
(`packages/correlation/data/observatory-snapshot.json`; generated, never edited by hand). Before
a release:

```bash
pnpm observatory:snapshot                 # fetch the public data/index.json, validate, rewrite the file
pnpm observatory:snapshot -- --from=<site dir or index.json>   # from a local copy instead
pnpm observatory:snapshot:check           # compare only; exit 1 on drift (generatedAt is ignored)
```

The script validates every field (hostnames, dates, integer counts), refuses reserved names
(`.test`, `.invalid`, `.example`, `.localhost`), caps the table at 500 hosts and 10 sites per host
and sorts by host. `validateObservatorySnapshot` in `packages/correlation` applies the same
rules at load time and in a test on the committed file. The wording in the UI states that a host
that was not seen says nothing either way.

## Wording rule

Everything shown by the site and these tools describes observed traffic and documented
infrastructure. It does not use words that claim a device or person is compromised, or that
claim the absence of a problem. The site's legend repeats this on every section that lists
contacts, and a test checks the generated HTML for the forbidden words.
