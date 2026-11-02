# Phase 6 report — Release readiness

Date: 2026-11-02. Work by Claude Fable 5.1 (main session); UI localisation pass by a Sonnet
subagent under the main session's specification and review. `prompt.md` defines Phases 1–5;
Phase 6 is the remaining roadmap (cross-cutting items plus what Phases 4–5 carried forward),
approved to start on 2026-11-02.

## What was built

| Milestone                    | State                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 Signed indicator bundles | implemented + verified  | Ed25519 over canonical JSON, pinned project key, SHA-256, full set validation, same-id and newer-version rules, diff preview, two-click activation, rollback, re-verification on every start. File import only; no network.                                                                                                                                                                                            |
| 6.1 Maintainer tooling       | implemented + verified  | `pnpm indicators:sign keygen\|sign\|verify`; first bundle published in `feeds/` and checked by an integration test against the pinned key.                                                                                                                                                                                                                                                                             |
| 6.2 Reproducible packaging   | implemented + verified  | Own deterministic zip writer; `pnpm release:check` builds all four variants twice and compares bytes; source archive, CycloneDX SBOM, `SHA256SUMS`; version 0.2.0; CHANGELOG.                                                                                                                                                                                                                                          |
| 6.2 Release workflow         | implemented, unverified | Tag-driven GitHub Actions workflow (same checks + reproducibility + draft release). Not exercised: no tag has been pushed from this environment.                                                                                                                                                                                                                                                                       |
| 6.2 Store submission         | documented only         | Needs maintainer accounts and credentials (`docs/release.md`).                                                                                                                                                                                                                                                                                                                                                         |
| 6.3 Accessibility            | reviewed + one fix      | Contrast of every text token pair ≥ 6.7:1; form-control border raised from 1.6:1 to ≥ 3.6:1; keyboard, semantics, motion and language attributes reviewed. No screen-reader walkthrough.                                                                                                                                                                                                                               |
| 6.3 Localisation             | implemented + verified  | `t()` with English keys; 534-entry bokmål dictionary covering popup and dashboard chrome (≈380 literal keys plus label tables); language setting Auto/English/Norsk; `<html lang>` follows it; a test asserts every wrapped key has a translation free of verdict wording. Rule content, hostnames and background error texts stay English by design. Translation reviewed by the main session (a few terms adjusted). |
| 6.4 Community                | implemented             | Issue templates for rule proposals, indicator proposals and bugs; CONTRIBUTING sections on rule acceptance, the indicator review process and localisation.                                                                                                                                                                                                                                                             |
| 6.4 Suricata `-T`            | not verified            | The container run was denied by the environment's permission policy again; the command remains in `docs/integration.md`.                                                                                                                                                                                                                                                                                               |

## Verification

| Check                                             | Result                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Unit + integration tests                          | 644 passed (incl. 15 signed-bundle unit tests, 3 published-feed tests, 10 i18n tests) |
| Typecheck, eslint, prettier, indicator validation | clean                                                                                 |
| `pnpm release:check`                              | second build byte-identical for all four extension zips, source archive and SBOM      |
| Firefox e2e (DEV)                                 | 12 of 12, including the in-browser Ed25519 verification of the published bundle       |
| Chromium e2e (DEV)                                | 10 of 10, including the in-browser Ed25519 verification of the published bundle       |
| Production builds                                 | Firefox `web-ext lint` 0/0/0; Chromium manifest check OK                              |

## Gate 6

- Byte-for-byte reproducibility from a clean checkout: met locally (`release:check`); the CI
  path exists but has not run.
- Signed bundle imports and verifies in both browsers: the verification step is proven in
  both browsers by the DEV self-test; the import UI was exercised only through unit tests of
  its background handlers' building blocks, not by clicking in a browser.
- Keyboard-only walkthrough: reviewed from markup and code, not performed by a person.

## Carried forward

- Push a tag and confirm the release workflow and the CI `SHA256SUMS` match the local ones.
- Store submissions (maintainer credentials).
- Screen-reader walkthrough; automated accessibility testing would add a dependency.
- Suricata/Zeek execution of the feeds.
- Key rotation procedure is documented; a second key has not been generated.
