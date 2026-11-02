# Phase 1 report — Firefox MVP

Date: 2026-11-02 · Commits: `acde9ae`, `6b1039f` · Package: `apps/extension-firefox/web-ext-artifacts/adtripwire-0.1.0.zip`

## 1. Working source code

Monorepo (pnpm, strict TypeScript, zero runtime dependencies) with five packages and one
app: `shared` (contracts), `indicators` (matcher, validation, bundled set), `privacy`
(sanitizer, redaction, export), `detection-engine` (19 rules, analyser, correlation),
`sensor-firefox` (webRequest + StreamFilter), `apps/extension-firefox` (MV3 event page,
popup, dashboard). See `docs/architecture.md`.

## 2. Build and development commands

`pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:perf`,
`pnpm indicators:validate`, `pnpm build`, `pnpm ext:lint`, `pnpm ext:package`,
`pnpm e2e:firefox`, `pnpm docs:rules`. Full list in `README.md` and `CLAUDE.md`.

## 3. Installation (Firefox 128+)

`pnpm build && pnpm ext:run`, or `about:debugging` → Load Temporary Add-on →
`apps/extension-firefox/dist/manifest.json`, or sign and install the zip. Host access to
all sites is requested at install and can be revoked; nothing is observed without it.

## 4. Tests and results

| Suite                                               | Result                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Unit + synthetic integration (vitest, 20 files)     | 325 passed                                                                                    |
| Performance (`tests/performance`)                   | 4 passed; 50 k events ingested at ≈26 µs/event, window ≤ 5000, analyser 536 K chars in ≈21 ms |
| Indicator validation                                | OK (165 real, 7 synthetic, reserved-name separation enforced)                                 |
| `web-ext lint` on production build                  | 0 errors, 0 warnings                                                                          |
| Headless Firefox 157.0.1 e2e against local fixtures | 9/9 checks passed                                                                             |

## 5. Detection rules

19 rules (A: 3, B: 4, C: 2, D: 6, E: 3, F: 1), each with id, version, severity,
confidence basis, required evidence and capabilities, limitations, false-positive notes
and references. Catalogue generated from code: `docs/detection-methodology.md`.
Key behaviours: empty NOAS response = informational (exposure, not selection); non-empty
JavaScript from a NOAS endpoint is elevated only when corroborated by a documented host or
suspicious markers; the AdFection chain (NOAS → delivered script → malicious host) is high
priority, downgraded when the "NOAS" host is the page's own.

## 6. Architecture summary

Sensor builds sanitized `NormalizedEvent`s → engine annotates indicator matches, evaluates
capability-gated rules, correlates in a bounded 5-minute window, de-duplicates with
severity escalation → detections and only their referenced events persist in
`storage.local`; the window snapshot lives in `storage.session`. UI talks to the
background through a validated message protocol. No blocking, no modification, no network
calls by the extension.

## 7. Capability and visibility matrix

`docs/browser-capabilities.md`. Firefox exposes all eight capabilities used; Chromium MV3
lacks body inspection, frame ancestry, third-party flag and tracking classification, so
categories B (response) and D would not be evaluable there.

## 8. Known technical limitations

`docs/limitations.md`. Highlights: no page-context instrumentation; inspection only for
indicator hosts and NOAS paths; 2 of 305 validator domains public; CloudFront hosts
time-bounded; no indicator update mechanism; tab-level (not frame-lineage) correlation;
no real-world false-positive measurement yet.

## 9. Security and privacy

`docs/privacy.md`, `docs/threat-model.md`, `SECURITY.md`. Local only; query values,
credentials, fragments, token-like path segments and parameter names never stored;
private windows excluded; 7-day retention; redacted exports with a strict pseudonymising
profile. Independent adversarial review (Opus) on 2026-11-02 found and we fixed: a ReDoS
in the analyser, an inspection opt-out bypass, async listener registration on the event
page, missing inspection budget, weak snapshot validation, O(K·R) chain search, a deletion
race, and sanitizer gaps.

## 10. Proposed Phase 2 priority order

1. Benign-browsing false-positive study and rule tuning (`noas_request`,
   `noas_then_hidden_frame`, tab-level chains).
2. Frame-lineage correlation instead of tab-level.
3. Context-aware JavaScript analysis (proximity, comment/string exclusion).
4. Optional, isolated page sensor with its own threat model.
5. Bundled Public Suffix List.
6. Indicator validity windows and signed, versioned indicator bundles.
7. Performance profiling in real browsing and adaptive caps.

## Status classification

**Implemented and verified**: build, lint, package; indicator matching and boundaries;
sanitizer guarantees; all 19 rules under synthetic tests; pass-through inspection with
byte-for-byte invariants; correlation, dedup, escalation, snapshot/restore; retention and
deletion at the storage layer; export redaction; in real Firefox: extension load,
capability detection, every fixture scenario's detections, severity escalation, dashboard
rendering without errors, benign page producing nothing.

**Implemented but not verified in the browser**: popup interactions, export download and
deletion through the UI, persistence across disable/enable via `about:addons`, host
permission revocation flow. Manual procedure in `docs/testing.md`.

**Planned, not implemented**: Chromium sensor, indicator updates with integrity checks,
STIX/SIEM export, page-context sensor, local AI assistance, real-world false-positive
measurement.
