# AdTripwire

**Detect the threat behind the ad.**

AdTripwire is an open-source, privacy-preserving Firefox extension that detects
observable indicators of surveillance, invasive profiling and potential spyware delivery
through online advertising infrastructure. Its first research focus is the **AdFection**
technique documented by [The Citizen Lab](https://citizenlab.ca/research/how-discover-tech-turned-targeted-ads-into-a-pipeline-for-spyware/)
and [Confiant](https://blog.confiant.com/p/adint-weaponized-ad-tech-for-zero-click-spyware-and-mass-identity-vacuuming)
on 15 October 2026, in which targeted ads delivered Candiru spyware.

AdTripwire is **not an ad blocker**. It observes, detects, explains and preserves
evidence. It never blocks, modifies or redirects traffic, and it makes no network
requests of its own.

> **Fundamental limitation.** AdTripwire can never show that a device is free of
> spyware. It distinguishes exposure to documented infrastructure, indicators of invasive
> tracking, suspicious delivery patterns and evidence consistent with an attempted
> exploit. Confirmed compromise requires independent forensic evidence. Absence of
> detection is not evidence of absence.

## What it does today

Firefox and Chromium (both Manifest V3; Chromium has reduced visibility, see
`docs/browser-capabilities.md`). Everything runs locally in the browser.

- **Detection**: a curated set of documented hostnames and domains plus rule-based detection in
  six categories (A known infrastructure, B suspicious ad-delivery behaviour, C fingerprinting
  and invasive profiling, D suspicious JavaScript techniques, E temporal correlation, F repeated
  exposure). Every detection says what was observed, why it may matter, benign explanations
  and limitations.
- **Exposure view**: every documented host this browser contacted, as a story (site, ad frame,
  documented host), with a copy-ready sanitized note for researchers.
- **Morning line and calendar**: "Yesterday: N pages, N contacts with documented
  infrastructure", compared with your own 30-day normal, and a 365-day calendar. Built from
  per-day counters on the device; pages are counted, never named.
- **Exports**: sanitized evidence JSON, STIX 2.1, SIEM NDJSON, and a hand-off package for
  helplines and analysts. Zeek/Suricata feeds are generated from the indicator set.
- **Signed indicator bundles**: optional, verified updates to the indicator set, never fetched
  by the extension itself.
- **Bundled observatory snapshot**: each documented host carries a note on how often generic
  automated profiles saw it, taken from the public observatory when the extension was built.
- **Release state**: v0.2.0 is on GitHub Releases. Store submission is pending; there are no
  Firefox Add-ons or Chrome Web Store listings yet.

### The observatory

[The observatory](https://reglund.github.io/adtripwire-observatory/) publishes the daily
automated runs, with synthetic profiles over fixed site lists, in full; nothing in it describes
a person. See `docs/observatory.md`; other machines can join as rigs (`docs/rig-setup.md`).

## Install

**Easiest:** download the zip for your browser from
[GitHub Releases](https://github.com/reglund/AdTripwire/releases) (v0.2.0; checksums in
`SHA256SUMS`, reproducible from the tagged commit with `pnpm release:check`) and load it as a
temporary add-on (Firefox) or unpacked extension (Chromium, after unzipping). Store listings are
pending.

**From source.** Prerequisites on Ubuntu 24.04: Node.js 20+, pnpm 10 (`corepack enable`),
Firefox 128+ or a current Chromium/Chrome.

```bash
git clone https://github.com/reglund/AdTripwire.git
cd AdTripwire
pnpm install
pnpm build                 # packages, then apps/extension-firefox/dist and apps/extension-chromium/dist
pnpm ext:run               # Firefox with the extension temporarily loaded
```

To run the daily exposure rig in Docker on a server instead: `docs/rig-docker.md`.

- **Firefox**, manually: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
  Add-on…**, select `apps/extension-firefox/dist/manifest.json`. `pnpm ext:package` builds a zip
  for signing.
- **Chromium / Chrome**: open `chrome://extensions`, enable Developer mode, **Load unpacked**,
  select `apps/extension-chromium/dist`. Chromium MV3 cannot inspect response bodies, so the
  JavaScript-technique rules and the response branch of the NOAS rules are shown as **not
  evaluable**.

The extension needs access to all sites because ads appear everywhere. Firefox asks for it in
the popup, and nothing is observed until it is granted. Chrome and Chromium grant it at
install, so there is no prompt; you can restrict or revoke it under `chrome://extensions` →
AdTripwire → Details → Site access at any time.

## Using it

The toolbar icon shows a number when documented infrastructure was contacted in the last
seven days. The popup answers the main question first, with the morning line. The dashboard has
Overview, Exposure, Detections (filter by category, severity, confidence), Indicators, Rules and
Settings (retention, export, deletion, and the manifest the browser loaded). Evidence export
comes in two redaction profiles: `default` keeps sanitized hostnames; `strict` pseudonymises
every non-subject hostname.

Detection priorities are **Informational → Suspicious → Elevated → High priority**.
They are investigation priorities, not probabilities of compromise. Confidence
(low/medium/high) is tracked separately and each rule states what establishes it.

## Development

```bash
pnpm typecheck           # strict TypeScript across the workspace
pnpm lint                # eslint + prettier
pnpm test                # vitest (unit + synthetic integration)
pnpm test:perf           # performance bounds
pnpm indicators:validate # dataset checks
pnpm ext:lint            # web-ext lint on the built extension
pnpm e2e:firefox         # headless Firefox run against local synthetic fixtures
pnpm e2e:chromium        # headless Chrome/Chromium run (reduced capability expectations)
pnpm e2e:firefox:assist  # same, with the optional --assist build and a mock local model runtime
pnpm eval:assist         # evaluate local models on synthetic scenarios (see docs/local-assist.md)
pnpm release:check       # reproducible release zips, source archive, SBOM, SHA256SUMS (docs/release.md)
pnpm exposure:build && pnpm exposure:firefox   # interactive real-traffic exposure run (docs/testing.md)
pnpm indicators:sign     # keygen | sign | verify signed indicator bundles (docs/indicator-updates.md)
pnpm docs:rules          # regenerate the rule catalogue in docs/detection-methodology.md
```

Run one test file: `pnpm vitest run packages/indicators/src/matcher.test.ts`.
Dev build with synthetic test indicators and a local fixture server: see
`docs/testing.md`.

## If you are concerned

AdTripwire observes; it does not reduce exposure. The Citizen Lab report recommends, for people
who may be targeted: turn off app tracking on iPhone (Settings → Privacy & Security → Tracking)
and delete the advertising ID on Android (Settings → Privacy → Ads), reset it regularly, and use
a trusted ad blocker, a privacy-focused browser, or ad blocking on the home router or a trusted
VPN. Blocking ads also leaves AdTripwire less to observe; that is the intended effect. Personal
advice: [Security Planner](https://securityplanner.consumerreports.org/).

## Verify it yourself

The code is largely written by AI models under the maintainer's direction, so the privacy claims
should not rest on trust. `docs/verify-yourself.md` lists checks (policy, permissions, a grep over
the built bundles, storage, reproducible build) that take about ten minutes and do not depend on
who wrote the code. The Settings view shows the manifest the browser loaded.

## Documentation

- `docs/architecture.md` – packages and data flow
- `docs/privacy.md` – what is stored, what never is, permissions
- `docs/threat-model.md` – what is detectable, and threats against the tool itself
- `docs/detection-methodology.md` – rules, severities, confidence
- `docs/limitations.md` – known gaps
- `docs/verify-yourself.md` – checks a sceptical reader can run without trusting the author
- `docs/observatory.md` – the public daily measurements: method, data, publishing
- `docs/rig-setup.md` – running a measurement rig of your own
- `docs/exposure-session.md` – looking for real exposure in your own browsing
- `docs/release.md` – reproducible packaging, SBOM, store submission steps
- `docs/testing.md` – automated and manual verification
- `docs/browser-capabilities.md` – Firefox vs Chromium visibility matrix
- `docs/local-assist.md` – related-activity grouping and the optional local-model build
- `docs/integration.md` – STIX/SIEM exports, imports, Zeek/Suricata feeds
- `docs/indicator-updates.md` – signed, optional indicator updates
- `docs/store-listing.md` – store texts and permission justifications
- `docs/amo-submission.md` – Firefox Add-ons submission guide with reproducible-source instructions
- `docs/roadmap.md` – phases and gates
- `docs/phase-*-report.md` – phase reports
- `CHANGELOG.md` – release notes

## Indicators and attribution

Indicator data derives from the cited Citizen Lab and Confiant reports and from
Recorded Future's 2025 Candiru appendix, via the CC0-licensed curation in
[Zero Breach](https://github.com/interplains/zero-breach). IP addresses, file hashes and
2021–2022 historical sets are deliberately excluded (`scripts/import-zero-breach.mjs`
documents the policy). AdTripwire is independent and not affiliated with or endorsed by
any of these organisations. Registrable-domain lookups use the ICANN section of the
[Public Suffix List](https://publicsuffix.org/) (MPL-2.0; notice in
`packages/indicators/data/PUBLIC-SUFFIX-LIST-LICENSE.md`).

## How this code was made

The code is largely written by AI models under the maintainer's direction. The reviews and tests
are also largely model-written. The maintainer is the human in the loop, and nobody has read
every line. That is why `docs/verify-yourself.md` exists: the checks there do not depend on who
wrote the code, so your trust does not have to either.

## License

Apache-2.0 for the code. Indicator data in `packages/indicators/data/` is CC0-1.0, except the derived Public Suffix
List (MPL-2.0).
See `SECURITY.md` for reporting vulnerabilities and `CONTRIBUTING.md` for contributing.
