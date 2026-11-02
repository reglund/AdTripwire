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

Verified on 2026-11-02 with Firefox 157.0.1 (snap) on Ubuntu 24.04: ready line with all
eight capabilities, NOAS contact (elevated), NOAS request (suspicious), empty NOAS
response (informational), hidden-iframe markers (suspicious), escalation of the NOAS
response to elevated once the body was inspected, nested frame to indicator (elevated),
malicious contact (elevated), and `correlation.adfection_chain` (high priority). The
benign scenario produced no detections.

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

## Detection quality

Two separate evaluations are maintained and must not be conflated:

1. **Synthetic coverage** – the scenarios above and the integration suite.
2. **Real-world false positives** – a benign browsing run (see
   `tests/fixtures/benign-browsing.md` for the session protocol) with the production
   build, recording every detection and its category. Phase 1 has **not** yet produced a
   benign-browsing measurement; this is a Phase 2 deliverable.

Scenarios that cannot be tested without genuine samples: real NOAS selection, real
validator and C2 traffic, exploit delivery. These remain unverified by design.
