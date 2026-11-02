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

## Status: Phase 1 (Firefox MVP)

| Area                                                                               | State                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------- |
| Firefox MV3 extension, builds and lints with `web-ext`                             | implemented                             |
| Curated indicator set (165 hostnames/domains, CC0 data, three classifications)     | implemented                             |
| Rule-based detection engine, categories A–F, explainable detections                | implemented                             |
| Pass-through response inspection for NOAS/indicator hosts (Firefox `StreamFilter`) | implemented                             |
| Temporal correlation, dedup, repeated-exposure counters                            | implemented                             |
| Popup, investigation dashboard, sanitized JSON export, deletion, retention         | implemented                             |
| Automated unit, synthetic integration and performance tests                        | implemented                             |
| Browser-level end-to-end verification                                              | manual procedure, see `docs/testing.md` |
| Chromium support, indicator updates, SIEM/STIX export                              | planned (Phases 3–4)                    |

## Install (development build)

Prerequisites on Ubuntu 24.04: Node.js 20+, pnpm 10 (`corepack enable`), Firefox 128+.

```bash
git clone https://github.com/reglund/AdTripwire.git
cd AdTripwire
pnpm install
pnpm build                 # builds packages and apps/extension-firefox/dist
pnpm ext:run               # launches Firefox with the extension temporarily loaded
```

Or load manually: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on…**, and select `apps/extension-firefox/dist/manifest.json`. To produce a zip for
signing: `pnpm ext:package` (output in `apps/extension-firefox/web-ext-artifacts/`).

The extension asks for access to all sites because ads appear everywhere; you can revoke
and re-grant it at any time. Nothing is observed until it is granted.

### Chromium / Chrome (Phase 3, reduced visibility)

```bash
pnpm --filter @adtripwire/extension-chromium run build   # → apps/extension-chromium/dist
```

Open `chrome://extensions`, enable Developer mode, **Load unpacked**, select
`apps/extension-chromium/dist`. Chromium MV3 cannot inspect response bodies and does not
expose frame ancestry, third-party status or tracking classification directly, so the
JavaScript-technique rules and the response branch of the NOAS rules are reported as
**not evaluable** in the dashboard; frame ancestry is reconstructed from `webNavigation`.
See `docs/browser-capabilities.md`.

## Using it

- **Toolbar popup**: monitoring state, counts of known-IOC observations, suspicious
  patterns and high-priority detections, last significant observation.
- **Investigation dashboard**: Overview, Detections (filter by category, severity,
  confidence), detection details (what was observed, why it matters, rule, evidence,
  event sequence, references, benign explanations, investigation steps, limitations),
  Indicators, Rules, Settings (retention, export, deletion).
- **Evidence export**: sanitized JSON for incident response (`default` keeps sanitized
  hostnames; `strict` pseudonymises every non-subject hostname).

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
pnpm docs:rules          # regenerate the rule catalogue in docs/detection-methodology.md
```

Run one test file: `pnpm vitest run packages/indicators/src/matcher.test.ts`.
Dev build with synthetic test indicators and a local fixture server: see
`docs/testing.md`.

## Documentation

- `docs/architecture.md` – packages and data flow
- `docs/threat-model.md` – what is detectable, and threats against the tool itself
- `docs/detection-methodology.md` – rules, severities, confidence
- `docs/browser-capabilities.md` – Firefox vs Chromium visibility matrix
- `docs/privacy.md` – what is stored, what never is, permissions
- `docs/limitations.md` – known gaps
- `docs/testing.md` – automated and manual verification
- `docs/indicator-updates.md` – design for signed, optional indicator updates
- `docs/store-listing.md` – store texts and permission justifications
- `docs/exposure-session.md` – how to look for real exposure in your own browsing
- `docs/integration.md` – STIX/SIEM exports, imports, Zeek/Suricata feeds
- `docs/roadmap.md` – phases and gates
- `docs/phase-1-report.md` – Phase 1 deliverables and status
- `docs/phase-3-report.md` – Phase 3 (Chromium) deliverables and status
- `docs/phase-4-report.md` – Phase 4 (research integration) deliverables and status

## Indicators and attribution

Indicator data derives from the cited Citizen Lab and Confiant reports and from
Recorded Future's 2025 Candiru appendix, via the CC0-licensed curation in
[Zero Breach](https://github.com/interplains/zero-breach). IP addresses, file hashes and
2021–2022 historical sets are deliberately excluded (`scripts/import-zero-breach.mjs`
documents the policy). AdTripwire is independent and not affiliated with or endorsed by
any of these organisations. Registrable-domain lookups use the ICANN section of the
[Public Suffix List](https://publicsuffix.org/) (MPL-2.0; notice in
`packages/indicators/data/PUBLIC-SUFFIX-LIST-LICENSE.md`).

## License

Apache-2.0 for the code. Indicator data in `packages/indicators/data/` is CC0-1.0, except the derived Public Suffix
List (MPL-2.0).
See `SECURITY.md` for reporting vulnerabilities and `CONTRIBUTING.md` for contributing.
