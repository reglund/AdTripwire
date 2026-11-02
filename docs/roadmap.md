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

## Phase 2 — Enhanced behavioural detection ⬜

Priority order (proposed):

1. **Benign-browsing false-positive study** with the production build
   (`tests/fixtures/benign-browsing.md`); tune `ad_delivery.noas_request`,
   `correlation.noas_then_hidden_frame` (`impid` is a common parameter) and tab-level
   chain anchoring based on results. Publish `docs/evaluations/`.
2. **Ad-frame correlation**: correlate on frame lineage (ancestor chain) rather than tab,
   so unrelated frames in one tab do not form a chain; weight evidence by frame proximity.
3. **Context-aware JS analysis**: proximity-based marker co-occurrence (same function
   body), reduced lexical false positives (comments/strings), minified-bundle baseline.
4. **Optional isolated page sensor** behind an explicit opt-in with its own threat model:
   observe `postMessage('*', analytics_sdk_ready)`, hidden iframe insertion and
   `document.cookie` reads in ad frames via a content script in ad-frame contexts only.
5. **Public Suffix List** (bundled, versioned) for registrable-domain logic.
6. **Indicator provenance v2**: per-indicator validity window (`validFrom`/`validTo`),
   time-bounded CloudFront hosts expire automatically; signed indicator bundles with
   versioning and rollback (still offline by default; opt-in update check).
7. **Performance**: measure real-world overhead with the Firefox profiler; adaptive
   inspection caps; sampled metrics in the dashboard.

Gate 2: documented false-positive rate on the benign protocol with zero high-priority
false positives, frame-lineage correlation tested, page sensor (if shipped) reviewed.

## Phase 3 — Chrome/Chromium support ⬜

- `packages/sensor-chromium`: MV3 service worker, observational `webRequest` only,
  capability declaration without `response_body_inspection`, `frame_ancestry`,
  `third_party_flag`, `url_classification`.
- Shared UI and engine; dashboard explains which rules are not evaluable.
- Store listing requirements, permissions explanation, documented capability gaps.

Gate 3: same synthetic suite passes on the Chromium subset of rules; no faked body
inspection.

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
