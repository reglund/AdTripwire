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
data/runs/<date>-<slug>.json       the run, as written by the harness (scrubbed)
data/runs/<date>-<slug>.evidence.json   the extension's evidence export, when present
data/reports/<date>-<slug>.md      the per-run Markdown report, when present
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

## Reproducing a day

From a fresh checkout (`pnpm install` first):

```sh
pnpm observatory:reproduce -- --date=2026-11-04 --variant=chromium-pixel-5 \
  --from=https://<owner>.github.io/<repository>
```

`--from` is a site directory or an `https://` URL of the published site (other schemes are refused; default
`~/.cache/adtripwire-exposure/site`). The script resolves the slug to the flags of
`scripts/exposure-run.mjs`, builds the evaluation bundle for that browser into a scratch
directory, runs the same site list with a fresh profile, and compares the result with the
published `data/runs/<date>-<slug>.json`. Options: `--seconds=60`, `--limit=N` (both sides are
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

## Wording rule

Everything shown by the site and these tools describes observed traffic and documented
infrastructure. It does not use words that claim a device or person is compromised, or that
claim the absence of a problem. The site's legend repeats this on every section that lists
contacts, and a test checks the generated HTML for the forbidden words.
