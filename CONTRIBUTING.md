# Contributing

Thank you for helping make advertising-based surveillance observable.

## Ground rules

- **Passive first.** Phase 1 never blocks, cancels, redirects or modifies traffic.
- **No invented indicators.** Every indicator needs a public source URL, a publication
  date and an explicit classification (`malicious`, `surveillance`, `contextual`).
  Real indicators never use reserved test names; synthetic fixtures use only `.test` /
  `.invalid`. `pnpm indicators:validate` enforces the separation.
- **Explainable rules.** Every rule declares id, name, version, description, category,
  severity, confidence basis, required evidence, required capabilities, references,
  limitations and false-positive considerations, and ships with tests. A single weak
  signal must never produce more than an informational detection.
- **Conservative language.** Detections describe observations ("traffic to documented
  infrastructure was observed"), never conclusions about the person or device.
- **Privacy by construction.** Never store query values, cookies, tokens, page content
  or full URLs. If you need a new field, add it to the sanitizer with tests proving
  what it cannot contain.
- **Zero runtime dependencies** in the extension. Justify any new dev dependency.

## Workflow

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm ext:lint
```

Open a pull request against `main`. CI must be green. Describe what is implemented and
verified, implemented but not verified, and planned.

## Adding an indicator

Edit `scripts/import-zero-breach.mjs` (for upstream-derived data) or add a new set file
under `packages/indicators/data/` with full `meta` (sources, license, `synthetic: false`)
and run `pnpm indicators:validate`.

## Adding a rule

Create `packages/detection-engine/src/rules/<name>.ts` exporting `definition` and the
evaluator, register it in the rules index, add positive, negative and false-positive
tests, and document it in `docs/detection-methodology.md`.

## Proposing a detection rule

Use the "Detection rule proposal" issue template. A rule is accepted when it keys on an
observable fact, cites public sources, declares severity (investigation priority) and
confidence with rationale, lists benign explanations, and comes with positive, negative and
false-positive tests on reserved `.test` names. Wording must stay conservative: the rule
describes observed traffic and documented infrastructure, never a device state. Every rule
lives in its own file under `packages/detection-engine/src/rules/` and exports a
`RuleDefinition`; `pnpm docs:rules` regenerates the catalogue so documentation cannot drift.

## Indicator review process

1. Proposal via the "Indicator proposal or correction" template with provenance (public
   report, date, licence) and a classification rationale.
2. Two maintainers review: is the source public and reusable, is the classification the
   most conservative one the evidence supports, is a validity window needed (rotated
   infrastructure), does `pnpm indicators:validate` accept it (no IPs, no shared-hosting
   apexes, no public suffixes, no reserved names)?
3. Changes go through `scripts/import-zero-breach.mjs` (curation policy and manual entries),
   never by editing the generated JSON. The set `version` is bumped.
4. Release: the new built-in set ships with the next extension version, and a signed bundle
   is published for existing installs (`pnpm indicators:sign sign …`, see
   `docs/indicator-updates.md`). The signing key never enters the repository.

## Localisation

UI strings are English source text wrapped in `t()`; translations live in
`packages/extension-core/src/ui/i18n.nb.ts` (bokmål). Add a key only when the English
string exists in the UI; keep the conservative wording rule in every language.
