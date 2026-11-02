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

## Phase 4 — Security research integration ⬜

- STIX 2.1 and SIEM-compatible JSON export of detections and indicators.
- Import of Zero Breach scan results and IOC feeds (offline files first).
- Optional Zeek/Suricata companion rule set generated from the indicator data.
- Investigation workflow: case notes, timeline view, hand-off package for helplines.

Gate 4: an exported bundle round-trips into a STIX validator and a SIEM test harness.

## Phase 5 — Advanced local correlation ⬜

- Optional local model (e.g. via a local runtime) that explains detections, clusters
  related events and summarises timelines, strictly on top of deterministic evidence.
- Hard guardrails: the model never changes severity, never declares compromise, and its
  output is labelled as interpretation.

Gate 5: red-team review of guardrails; explanations evaluated against the rule evidence.

## Cross-cutting

- Accessibility and localisation of the UI (Norwegian first after English).
- Release engineering: signed AMO listing, reproducible builds, SBOM, release notes.
- Community: contribution guide, rule proposal template, indicator review process.
