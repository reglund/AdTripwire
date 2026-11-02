# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AdTripwire: a passive, local-only Firefox (MV3) extension that detects advertising-based
surveillance and spyware-delivery infrastructure (the AdFection technique, Citizen Lab /
Confiant, Oct 2026). Observation, detection and evidence only. It must never block or
modify traffic, make network requests of its own, or claim a device is compromised or
clean. `prompt.md` is the product brief and is authoritative on scope and phases: work
one phase at a time and do not start the next phase without the user's explicit go-ahead.

## Commands

```bash
pnpm install
pnpm typecheck                 # tsc -b across workspace (project references)
pnpm lint                      # eslint + prettier --check
pnpm test                      # vitest: packages/**, apps/**, tests/integration
pnpm vitest run packages/indicators/src/matcher.test.ts   # single file
pnpm vitest run -t "boundary"                             # by test name
pnpm test:perf                 # tests/performance (separate config)
pnpm indicators:validate       # dataset rules + reserved-name separation
pnpm build                     # packages, then esbuild → apps/extension-firefox/dist
pnpm ext:lint | ext:run | ext:package   # web-ext on dist
pnpm --filter @adtripwire/extension-firefox exec node build.mjs --dev   # bundles synthetic .test indicators
node scripts/fixture-server.mjs 8787     # local synthetic scenarios (see docs/testing.md)
node scripts/import-zero-breach.mjs      # regenerate packages/indicators/data/adfection-2026.json
node apps/extension-firefox/build.mjs --assist   # optional local-model build (loopback-only connect-src)
pnpm e2e:firefox:assist | e2e:chromium:assist    # e2e with mock Ollama runtime on 127.0.0.1:8787
pnpm eval:assist -- --endpoint URL --models a,b  # evaluate local models on synthetic scenarios
```

Note: `tsc -p <pkg> --noEmit` fails with TS6305 until referenced packages are built; use
`npx tsc -b <pkg>` or `pnpm typecheck`.

## Architecture (see docs/architecture.md)

Data flow: `sensor-firefox` (webRequest + StreamFilter) → `NormalizedEvent` →
`detection-engine` (rules A–F, bounded correlation window, dedup) → `Detection` →
`packages/extension-core/src/background` (shared between browsers via a `SensorAdapter`;
storage.local for detections + referenced events, storage.session for the window snapshot)
→ UI via validated `UiRequest` messages. `apps/extension-*` hold only manifest, build script
and thin entry files.

- `packages/shared` holds all type contracts. Change them first; everything else codes
  against them. `exactOptionalPropertyTypes` is on: omit optional props, never assign
  `undefined`.
- `packages/indicators` — `IndicatorMatcher` (exact hostname + boundary-safe domain
  suffix), `validateIndicatorSet`, bundled set loaded from `data/adfection-2026.json`
  (generated; edit the import script, not the JSON).
- `packages/privacy` — `sanitizeUrl` (hostnames, path patterns, query **names** only),
  redaction profiles, `buildEvidenceExport`. Sensors must pass every URL through it.
- `packages/detection-engine` — one file per rule in `src/rules/`, each exporting
  `definition: RuleDefinition` + evaluator; `analyzeJavaScript` returns marker ids only,
  never source text. Rules declare `requiredCapabilities`; unmet → "not evaluable".
- `packages/sensor-firefox` — `WebRequestSensor`: non-blocking observers on
  `<all_urls>`, ONE blocking listener scoped to indicator hosts + `/getAd` paths that
  attaches a pass-through filter (`write` first, cap, `disconnect`, analysis deferred).
- `packages/correlation` — Phase 5. Deterministic clustering/timeline/actions on stored
  detections, plus the assist layer: `buildAssistContext` is the ONLY path data may take to
  a model (allowlist, never notes), `screenAssistOutput` removes verdict sentences and masks
  unknown hostnames, `OllamaProvider` refuses non-loopback URLs. Model output is never
  stored or exported. Assist UI/network code exists only when `__ADTRIPWIRE_ASSIST__` is
  true (build flag `--assist`); keep assist-only calls inside `if (__ADTRIPWIRE_ASSIST__)`
  so the default build tree-shakes them (the build guard checks).
- UI (`packages/extension-core/src/ui`) is vanilla DOM via `h()`; no innerHTML with data.
  Host permission is requested from the page click handler (user gesture), not via the
  background.

## Invariants to preserve

- Zero runtime dependencies; no `eval`/`new Function`; CSP `script-src 'self'`,
  `connect-src 'none'`. The build guard fails on `eval(` or synthetic names in prod.
- Real indicators never use reserved TLDs; fixtures use only `.test`/`.invalid`.
- Detection text uses conservative wording (observed traffic, documented infrastructure);
  never "infected", "spied on", "safe".
- Every rule needs positive, negative and false-positive tests.
- Say which model/agent did work in reports; distinguish implemented+verified vs
  implemented-unverified vs planned.
