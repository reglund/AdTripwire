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
