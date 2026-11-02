# Testing

## Automated

```bash
pnpm install
pnpm indicators:validate   # dataset syntax, classification, reserved-name separation
pnpm typecheck             # tsc -b across all packages
pnpm lint                  # eslint + prettier
pnpm test                  # vitest: unit + synthetic integration
pnpm test:perf             # throughput / memory bounds
pnpm build && pnpm ext:lint
```

Run a single test file: `pnpm vitest run packages/indicators/src/matcher.test.ts`.
Filter by name: `pnpm vitest run -t "boundary"`.

Test layers:

| Layer                 | Location                   | What it proves                                                                                                                                                                                                                                        |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                  | `packages/*/src/*.test.ts` | normalization, boundary matching, sanitization, redaction, rule evaluation, correlation, dedup, stream pass-through, event building                                                                                                                   |
| Synthetic integration | `tests/integration/`       | end-to-end event sequences through the engine: benign ad, benign fingerprinting, IOC contact, NOAS empty vs selected, hidden iframe, full chain, false-positive scenarios, malformed/large responses, incomplete metadata, snapshot/restore (restart) |
| Performance           | `tests/performance/`       | ingest throughput, bounded window memory, analyser cost on large inputs                                                                                                                                                                               |

All fixtures use reserved names (`*.test`, `*.invalid`). The validation script fails if
a reserved name appears in the real indicator set or a real-looking name appears in the
synthetic set.

## Browser-level verification in Firefox

### Automated (local)

```bash
pnpm e2e:firefox            # headless; ~90 s
pnpm e2e:firefox --headed   # visible window
```

`scripts/e2e-firefox.mjs` builds a dev bundle (with the synthetic indicator set), starts
the local fixture server, launches Firefox through `web-ext run` with
`network.dns.localDomains` mapping the reserved `.test` hostnames to localhost, opens the
four fixture scenarios, captures the extension's console via
`devtools.console.stdout.content`, and asserts that the expected detections appear and
that no forbidden wording is used. It requires a local Firefox; it is not part of CI.
Snap-packaged Firefox cannot read profiles under `/tmp`, so the script uses a profile
under `~/snap/firefox/common/`. The full log is written to
`node_modules/.cache/adtripwire/e2e-firefox.log`.

Verified on 2026-11-02 with Firefox 157.0.1 (snap) on Ubuntu 24.04 (Phase 2 build): ready
line with all capabilities, page sensor registered and reporting `script_inserted` /
`hidden_iframe_inserted` from the creative frame, `page.hidden_iframe_after_load` elevated
through frame-lineage anchoring, `page.late_third_party_script` suspicious, NOAS contact (elevated), NOAS request (suspicious), empty NOAS
response (informational), hidden-iframe markers (suspicious), escalation of the NOAS
response to elevated once the body was inspected, nested frame to indicator (elevated),
malicious contact (elevated), and `correlation.adfection_chain` (high priority). The
benign scenario produced no detections.

### Chromium (Phase 3)

```bash
pnpm e2e:chromium           # headless Google Chrome / Chromium, ~60 s
```

`scripts/e2e-chromium.mjs` builds a dev bundle of `apps/extension-chromium`, launches Chrome
with `--load-extension` and `--host-resolver-rules` mapping the reserved `.test` names to
localhost, captures console output via `--enable-logging=stderr`, and asserts the reduced
Chromium expectations: indicator contacts and the NOAS request rule fire, the page sensor
registers and reports, and **no** `js.*` detection or `response_body_inspection` capability
appears, because Chromium MV3 cannot inspect response bodies. Headless Chrome accepts a
single start URL, so the run opens the fixture page `/all`, which embeds the four scenarios
as iframes. Branded Google Chrome ignores `--load-extension` (since 137): use the Chromium
snap or Chrome for Testing (`CHROME_BIN=...`). Snap Chromium needs the profile under
`~/snap/chromium/common/`, which the script handles.

### Manual

1. Build a dev bundle (includes the synthetic indicator set):
   ```bash
   node apps/extension-firefox/build.mjs --dev
   ```
2. Start the local fixture server (no internet contact):
   ```bash
   node scripts/fixture-server.mjs 8787
   ```
3. Launch Firefox with the extension and map the synthetic hostnames to localhost
   (Firefox-only pref; no `/etc/hosts` edits). With snap Firefox add
   `--firefox-profile=$HOME/snap/firefox/common/adtripwire-dev --profile-create-if-missing`:
   ```bash
   pnpm exec web-ext run -s apps/extension-firefox/dist \
     --pref network.dns.localDomains=publisher.synthetic-site.test,ads.synthetic-benign.test,noas.synthetic-adfection.test,c2.synthetic-adfection.test,validator.synthetic-adfection.test,staging.synthetic-dsp.test
   ```
4. Visit, in order, and check the popup / dashboard after each:
   - `http://publisher.synthetic-site.test:8787/benign` → no detections.
   - `/exposure` → NOAS contact (elevated) + NOAS request (suspicious) + empty response (informational). No high priority.
   - `/selected` → in addition: non-empty JS response (elevated after inspection), hidden-iframe JS markers, nested frame / contact with validator and C2 synthetic hosts, and a `correlation.adfection_chain` high-priority detection.
   - `/ioc` → malicious contact (elevated).
5. Dashboard → Settings → Export (default and strict); confirm no query values appear
   in the JSON and the disclaimer is present.
6. Disable and re-enable the extension (about:addons) → detections persist.
7. Settings → Delete all collected data → counts return to zero.

Steps 5–7 exercise the UI and were **not** covered by the automated script in Phase 1;
they remain a manual check. Console lines are prefixed `[AdTripwire]`.

## Interactive exposure runs (real ad traffic)

```bash
pnpm exposure:build                 # evaluation builds (production indicators, dashboard opens on install)
pnpm exposure:firefox -- --seconds=75           # or exposure:chromium; add --mobile, --limit=N, --headed
node scripts/exposure-run.mjs --browser=firefox --sites=tests/fixtures/exposure-sites.txt --json=run.json
```

`scripts/exposure-run.mjs` drives a real browser through puppeteer-core (dev dependency):
it accepts consent dialogs (known CMP selectors plus button-text heuristics in every frame),
scrolls, opens one article per site and dwells, so programmatic auctions actually run. It
reads results through the extension's own UI protocol from the dashboard tab (not console
parsing), records per site the requests observed, the distinct third-party registrable
domains contacted (auction evidence) and new detections, and writes
`docs/evaluations/<date>-exposure-interactive-<browser>[-mobile].md`. Profiles persist in
`~/snap/<browser>/common/adtripwire-exposure-profile*` so cookies, consent and the
repeated-exposure rule carry over between daily runs. Firefox is driven over WebDriver BiDi
with `-remote-allow-system-access` (needed to evaluate inside the extension page); Chromium
via CDP with `--load-extension`.

### Lesson: evaluate with consent

The original benign-browsing evaluations ran headless without accepting consent dialogs, so
few programmatic auctions ran and cookie-sync redirect chains were rare. The first
consent-enabled exposure run (2026-11-02) showed 30-60 such chains per ad-heavy page, each a
separate `ad_delivery.redirect_chain` "suspicious" detection (93 % of detections in a sample).
The rule was retuned (per-tab aggregation, informational unless a hop reaches documented
infrastructure; the same two-page sample went from 74 to 7 detections), and false-positive
evaluations now use `scripts/exposure-run.mjs` with consent, e.g.
`node scripts/exposure-run.mjs --browser=firefox --sites=tests/fixtures/benign-sites.txt`.

## Local-model assistance (Phase 5)

```bash
pnpm e2e:firefox:assist     # DEV --assist bundle; fixture server mocks an Ollama runtime on 127.0.0.1 (8787 Firefox / 8788 Chromium)
pnpm e2e:chromium:assist
pnpm eval:assist -- --endpoint http://127.0.0.1:11434 --models qwen3:8b --languages en,nb
```

The `--assist` end-to-end runs add two console expectations from the dashboard's DEV-only
self-test page: a successful probe of the mock runtime and the guardrail flags
`asserted_compromise,unknown_hostname` with one sentence removed and one hostname masked.
This proves the CSP, CORS, fetch, JSON handling and screening together in the real browser.
`eval:assist` runs synthetic scenarios through the real pipeline against actual models and
writes `docs/evaluations/assist-eval.md` (`--rescreen <json>` re-applies screening to saved
answers). See `docs/local-assist.md`.

## Release and signed bundles (Phase 6)

```bash
pnpm release:check          # builds every variant twice; fails unless byte-identical; writes dist-release/
pnpm indicators:sign verify --in feeds/adtripwire-indicators-<version>.signed.json
```

`tests/integration/signed-feed.test.ts` verifies the published bundle against the pinned key
on every test run. DEV builds additionally verify it inside the browser at startup and log
`signed bundle selftest ok key=… version=…`, which both e2e harnesses expect, proving
Ed25519 WebCrypto verification in the real Firefox and Chromium builds.

## Accessibility review (Phase 6)

Checked on 2026-11-02 against the shipped stylesheet and markup:

- Contrast: every text/background token pair in both themes is at least 6.7:1 (WCAG AA needs
  4.5:1); severity badges 6.8–11.9:1. The border token used for form controls was 1.6:1 and
  was darkened to 3.6:1 light / 3.8:1 dark (WCAG 1.4.11 needs 3:1). Computed from the CSS
  variables with a small script; see the review date above.
- Keyboard: skip link, roving tabindex on the tab list (arrow keys, Home/End), focus moved to
  the main region after navigation, visible `:focus-visible` outline, buttons for every
  action (no click-only elements; table rows that navigate also contain a real link).
- Semantics: one `h1` per page, `h2` per view, cards use `h3`, tables have captions and
  `scope`d headers, status messages use `role="status"`, destructive flows confirm.
- Motion: animation only under `prefers-reduced-motion: no-preference`.
- Language: `<html lang>` follows the UI language setting; rule content stays English and is
  labelled as such in the Language setting.
- Not done: screen-reader walkthrough with NVDA/VoiceOver; automated axe run (would add a
  dependency).

## Detection quality

Two separate evaluations are maintained and must not be conflated:

1. **Synthetic coverage** – the scenarios above and the integration suite.
2. **Real-world false positives** – a benign browsing run (protocol in
   `tests/fixtures/benign-browsing.md`) with the production build, recording every
   detection by rule and severity. Automated variant:
   ```bash
   pnpm eval:benign            # headless Firefox over tests/fixtures/benign-sites.txt
   ```
   `scripts/benign-eval.mjs` builds the production bundle, opens the site list in batches,
   captures the extension console and writes `docs/evaluations/<date>-benign.md`. Results
   are recorded per run under `docs/evaluations/`. Headless runs under-count ads (no
   consent clicks, no scrolling), so they are a lower bound on exposure and should be
   complemented by an interactive session following the protocol.

Scenarios that cannot be tested without genuine samples: real NOAS selection, real
validator and C2 traffic, exploit delivery. These remain unverified by design.
