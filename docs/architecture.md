# Architecture

AdTripwire is a passive, local-only browser sensor. It observes advertising-related
network activity, matches it against documented indicators and behavioural rules, and
preserves sanitized evidence for investigation. It never blocks, modifies, or redirects
traffic, and it makes no network requests of its own.

```
 Firefox webRequest / StreamFilter          (browser-specific)
            │
            ▼
 packages/sensor-firefox   ── builds NormalizedEvent (sanitized) ──┐
                                                                   ▼
 packages/detection-engine ── rules A–F, correlation window, dedup ──► Detection
            ▲                                                      │
 packages/indicators (matcher, bundled IOC set)                    ▼
 packages/privacy (URL sanitizer, redaction, export)      apps/extension-firefox
                                                           background: storage, messaging
                                                           ui: popup, dashboard
```

## Packages

| Package                        | Responsibility                                                                                                                                                              | Browser APIs                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `@adtripwire/shared`           | Type contracts: events, detections, indicators, rules, capabilities, settings, export, UI messages.                                                                         | none                                                                |
| `@adtripwire/indicators`       | Hostname normalization, boundary-safe domain matching, indicator validation, bundled curated set.                                                                           | none                                                                |
| `@adtripwire/privacy`          | URL sanitization (names, not values), identifier-parameter classification, redaction profiles, evidence export.                                                             | none                                                                |
| `@adtripwire/detection-engine` | Rule registry, JavaScript marker analyser, bounded correlation window, dedup, exposure counters, capability gating.                                                         | none                                                                |
| `@adtripwire/correlation`      | Phase 5: deterministic clustering of detections, timeline narrative, suggested actions; assist context allowlist, prompt, output guardrails, loopback-only Ollama provider. | none (the provider is given `fetch` explicitly)                     |
| `@adtripwire/sensor-firefox`   | webRequest observers, scoped blocking listener that attaches a pass-through `StreamFilter`, capability detection.                                                           | `webRequest.*`, `filterResponseData`, `runtime.getBrowserInfo`      |
| `apps/extension-firefox`       | MV3 event page wiring sensor → engine → storage; strictly validated UI messaging; popup and dashboard.                                                                      | `storage.local`, `storage.session`, `alarms`, `permissions`, `tabs` |

The engine and the indicator/privacy packages have no browser dependency and run
under Node in tests. A future Chromium sensor implements the same `NormalizedEvent`
contract and declares a smaller capability set; rules requiring missing capabilities
are reported as "not evaluable" rather than silently skipped.

### Correlation and optional local-model assistance (Phase 5)

`@adtripwire/correlation` is pure and runs under Node. The background answers
`get_clusters` / `get_cluster` by clustering stored detections (union-find over shared
events, indicators, hostnames, registrable domains and same-tab proximity) and deriving a
timeline narrative and suggested actions from the result. `get_assist_package` builds the
only data a local model may see (`buildAssistContext`) and renders the prompt; the UI shows
that text, sends it to an Ollama-compatible runtime on 127.0.0.1 through `OllamaProvider`
(only in builds made with `--assist`), screens the answer with `screenAssistOutput` and
displays it labelled as interpretation. Model output is never stored, exported or fed back
into the engine. See `docs/local-assist.md`.

## Data flow in the Firefox extension

1. **Observation.** Non-blocking `onBeforeRequest`, `onBeforeRedirect`, `onCompleted`
   (with response headers) and `onErrorOccurred` listeners on `<all_urls>` build
   sanitized events. Only third-party or framed requests, indicator matches and
   NOAS-pattern paths are forwarded (see `docs/privacy.md`). Top-level navigations are
   never recorded.
2. **Inspection.** One blocking `onBeforeRequest` listener is registered with match
   patterns derived from the indicator set plus `*/getAd` and `*/cplatform/getAd`.
   Ordinary browsing never enters the blocking path. For eligible requests a
   `StreamFilter` is attached that writes every chunk through unmodified, buffers at
   most `responseInspectionMaxBytes`, disconnects at the cap, and runs the JavaScript
   marker analyser deferred, off the response path.
3. **Detection.** The engine annotates each event with indicator matches, evaluates
   rules whose capabilities are satisfied, correlates within a bounded time window,
   and de-duplicates. Detections carry observed vs inferred evidence, alternative
   explanations, limitations and references.
4. **Persistence.** Detections and only the events they reference go to
   `storage.local` with retention (7 days / caps by default). The correlation window
   snapshot goes to `storage.session` (memory-only) so an event-page restart does not
   lose in-flight correlation. Exposure counters (distinct days per surveillance host)
   are persisted in `storage.local`.
5. **Presentation.** The popup and dashboard talk to the background through
   `UiRequest`/`UiResponse` messages. The sender is checked to be the extension's own
   pages and every payload is shape-validated.

## Event-page lifetime

Firefox MV3 uses event pages, not service workers. All listeners are registered at the
top level synchronously. In-memory state is restored from `storage.session` /
`storage.local` on wake. Alarms drive retention sweeps.

## Build

esbuild bundles three entry points (background, popup, dashboard) into
`apps/extension-firefox/dist` with no remote code and no `eval`. A build guard fails the
production build if `eval(` or synthetic test indicators appear in the bundle.
`web-ext` lints and packages the directory.
