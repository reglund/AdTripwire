# Roadmap

Goal: anyone can install AdTripwire in Firefox, browse normally, and have it detect,
explain and preserve evidence of suspicious advertising-related activity, and security
researchers, journalists, NGOs and security teams can use that evidence. The roadmap
follows the phases in `prompt.md`. Each phase ends with a gate; the next phase does not
start without an explicit go-ahead.

Legend: ✅ done and verified · 🔶 implemented, not yet verified in a browser · ⬜ not started

## Phase 1 — Working Firefox MVP (current)

Milestone 1.1 Foundations ✅

- pnpm/TypeScript monorepo, strict types, shared contracts, CI, Apache-2.0.
- Curated indicator set (165 entries, CC0 data) with provenance and three
  classifications; validation script separates real and synthetic names.

Milestone 1.2 Core packages ✅

- indicators (matcher, validation), privacy (sanitizer, redaction, export),
  detection-engine (19 rules A–F, analyser, bounded window, dedup, exposure),
  sensor-firefox (observers, scoped pass-through StreamFilter).

Milestone 1.3 Extension integration ✅

- Background event page wiring sensor → engine → storage; validated messaging; popup
  and dashboard; manifest, build guard, `web-ext lint`.

Milestone 1.4 Verification 🔶

- Synthetic integration suite (benign ad, benign fingerprinting, IOC contact, NOAS
  empty/selected, hidden iframe, full chain, false positives, malformed/large responses,
  incomplete metadata, restart).
- Performance bounds (ingest throughput, window memory, analyser cost).
- Headless Firefox launch against the local fixture server (`pnpm e2e:firefox`), plus a documented manual procedure for UI flows.

Gate 1 (acceptance criteria, `prompt.md` §15): build + package, install, monitoring
operational, IOC + boundary matching, response inspection byte-for-byte, synthetic
suspicious event → visible detection, benign → no high priority, restart persistence,
deletion, redacted export, tests pass, README/limitations/privacy documented.

## Phase 2 — Enhanced behavioural detection (closed 2026-11-02 with approval; open items carried forward)

1. **Benign-browsing false-positive study** 🔶 — `pnpm eval:benign` automates a headless
   run over `tests/fixtures/benign-sites.txt`; results under `docs/evaluations/` (zero
   detections over 24 sites, ~3,200 observed requests). An interactive session following
   the protocol is still needed.
2. **Frame-lineage correlation** ✅ — chains anchored on frame lineage; tab-only chains
   downgraded one level with explicit inferred evidence.
3. **Context-aware JS analysis** ✅ — comment/string-blanked code view, marker proximity
   (4000 chars), minified-bundle baseline, fixed timer/iframe heuristics.
4. **Optional isolated page sensor** ✅ — opt-in content script in sub-frames, structural
   signals only, three `page.*` rules, threat model documented; verified in headless
   Firefox (`pnpm e2e:firefox`). `document.cookie` reads are not observable from an
   isolated world and are deliberately out of scope. UI consent flow is manual to verify.
5. **Public Suffix List** ✅ — bundled ICANN section (MPL-2.0 notice), used for
   registrable-domain logic in the engine.
6. **Indicator validity windows** ✅ (`validFrom`/`validTo`; expired matches lower
   confidence). **Signed indicator bundles** 🔶 — design in `docs/indicator-updates.md`;
   implementation pending, extension stays offline-only.
7. **Performance** 🔶 — runtime metrics card in the dashboard and a periodic aggregate
   stats line; Firefox-profiler measurement and adaptive caps pending.

Gate 2: documented false-positive rate on the benign protocol with zero high-priority
false positives (met for the headless run; interactive run pending), frame-lineage
correlation tested (met), page sensor reviewed (met, two reviews; see threat model).

Carried forward from Phase 2 (not blocking): interactive benign session, signed indicator
bundle implementation (`docs/indicator-updates.md`), Firefox-profiler performance pass,
manual verification of the page-sensor consent UI.

## Phase 3 — Chrome/Chromium support (delivered 2026-11-02, awaiting approval)

- `packages/sensor-chromium` ✅ — MV3 observational `webRequest`, frame tree from
  `webNavigation`, incognito handling via a tab cache, no inspection; 53 tests.
- Shared core ✅ — background, UI and page sensor moved to `packages/extension-core` behind a
  `SensorAdapter`; apps are manifest + build + entry files.
- `apps/extension-chromium` ✅ — service-worker manifest, `chrome`→`browser` shim, raster
  icons, manifest validator, CI package. Verified headless on Chromium 156
  (`pnpm e2e:chromium`): indicator and NOAS rules, page sensor, dashboard, no `js.*` rules.
- Dashboard explains non-evaluable rules on Chromium ✅ (engine capability gating).
- Store texts and permission justifications ✅ (`docs/store-listing.md`); Chromium
  benign-browsing run ✅ (zero detections, 24 sites); second-model review of the Chromium
  sensor ✅ (no critical/high; fixes applied). Pending: manual check in branded Google
  Chrome, store submissions.

Gate 3: synthetic suite passes on the Chromium rule subset (met headless); no faked body
inspection (met: `no_response_body_access` on every event).

## Phase 4 — Security research integration (delivered 2026-11-02, awaiting approval)

- STIX 2.1 export of detections and indicators ✅ (validated with the OASIS validator);
  STIX import of indicator bundles ✅ (bundled curation takes precedence).
- SIEM-compatible JSON ✅ (ECS 8.11 NDJSON for detections and observations).
- Zeek Intel and Suricata companion rules generated from the indicator set ✅ (`feeds/`,
  `pnpm feeds:export`; structurally tested, not executed in Suricata/Zeek).
- Zero Breach results: STIX import path ✅; on-device scan results have no stable public
  format yet ⬜.
- Investigation workflow ✅: analyst notes, timeline view, hand-off package.
- Security review of the import path ✅ (findings fixed; see threat model). Pending: run
  the Suricata rules through `suricata -T` (container run was blocked in this environment),
  review of exports/feeds beyond the package tests, manual UI verification of the new views.

Gate 4: an exported bundle round-trips into a STIX validator (met) and a SIEM test harness
(ECS structure tested; live ingestion into Elastic/OpenSearch not yet performed).

## Phase 5 — Advanced local correlation 🔶 (delivered 2026-11-02, awaiting approval)

- Deterministic correlation ✅: `@adtripwire/correlation` groups detections by shared
  requests, indicators, hostnames, registrable domains and same-tab proximity (union-find,
  linear), with a templated summary, timeline narrative and suggested investigative actions.
  New dashboard tab "Related activity" and group detail pages; detection pages link to their
  group.
- Optional local-model assistance ✅ (separate `--assist` build): loopback-only CSP and
  provider (Ollama-compatible `/api/chat`), explicit opt-in with preview of the exact text,
  allowlisted context (never notes), sentence-level verdict screen (EN/NB) with hedge
  detection, unknown-hostname masking, flags, labelling; answers never stored or exported.
  Default build keeps `connect-src 'none'` and the build guard rejects any loopback path.
- Verification ✅: 616 unit/integration tests incl. red-team guardrail cases; Firefox e2e 13/13
  and Chromium e2e 11/11 with the `--assist` build against a mock runtime (CSP, CORS, fetch,
  screening in the real browser); `eval:assist` against five real local models, report in
  `docs/evaluations/assist-eval.md`. Report: `docs/phase-5-report.md`.
- Security review of the Phase 5 diff (Opus); see the threat model's Phase 5 record.

Gate 5: red-team review of guardrails (done, findings fixed) and explanations evaluated
against rule evidence (done on synthetic scenarios with several local models; see the
evaluation report for the residual: screening is pattern-based and the label plus
side-by-side evidence carry the guarantee).

## Phase 6 — Release readiness ✅ (delivered and released 2026-11-02)

`prompt.md` defines Phases 1–5 only. Phase 6 is the remaining roadmap, approved to start on
2026-11-02: the cross-cutting items below plus what Phases 4–5 carried forward.

Milestone 6.1 Signed indicator bundles, offline

- Ed25519-signed bundle format (canonical JSON, SHA-256, key id), pinned project public key,
  verification in the import path via WebCrypto, version monotonicity, diff against the
  built-in set, one-click rollback to the built-in set. No network fetching: bundles are
  downloaded by the person and imported from a file, so `connect-src 'none'` stays.
- Maintainer tooling to generate keys and sign the generated dataset.

Milestone 6.2 Release engineering

- Deterministic packaging (sorted entries, fixed timestamps) for both browsers plus a source
  archive for store review; `SHA256SUMS`; CycloneDX SBOM; CHANGELOG; version 0.2.0.
- Tag-driven release workflow producing the artifacts; AMO/Chrome Web Store submission
  documented (needs maintainer credentials, not executed here).

Milestone 6.3 Accessibility and localisation

- Accessibility pass over popup and dashboard (landmarks, focus order, live regions,
  contrast, reduced motion).
- UI chrome in Norwegian bokmål behind a language setting (tabs, headings, settings, popup,
  buttons). Rule text (summaries, significance, actions) remains English in this phase.

Milestone 6.4 Community and carried-forward checks

- Rule proposal template, indicator review process, issue templates.
- Suricata `-T` / Zeek check if a tool is available; otherwise documented as unverified.

Gate 6: a tagged build reproduces byte-for-byte from a clean checkout (met: `v0.2.0` built in
GitHub Actions matches the local `SHA256SUMS` for every artifact, and the release is published
at https://github.com/reglund/AdTripwire/releases/tag/v0.2.0); a signed bundle verifies in both browsers
(met via the DEV self-test; the import UI itself was not click-tested); keyboard-only
walkthrough reviewed from markup, not performed by a person. Report: `docs/phase-6-report.md`.

## Cross-cutting (folded into Phase 6)

- Accessibility and localisation of the UI (Norwegian first after English).
- Release engineering: signed AMO listing, reproducible builds, SBOM, release notes.
- Community: contribution guide, rule proposal template, indicator review process.
