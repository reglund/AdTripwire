# Phase 3 report — Chrome/Chromium support

Date: 2026-11-02 · Commits: `2978cbb` (Chromium support), `384c0a7` (hardening, exposure
protocol) and the closing commit that includes this report · Packages: `apps/extension-firefox/web-ext-artifacts/adtripwire-0.1.0.zip`,
`apps/extension-chromium/web-ext-artifacts/adtripwire-0.1.0.zip`

## What was built

- **Shared core.** Background, popup, dashboard and the opt-in page sensor moved from the
  Firefox app into `packages/extension-core`, bound to a browser through a `SensorAdapter`
  (`browserName`, `detectCapabilities`, `createSensor`). Message handling uses
  `sendResponse` so it works on Chromium service workers as well as Firefox event pages.
  The Firefox app is now manifest + build script + four thin entry files.
- **Chromium sensor** (`packages/sensor-chromium`). Observational MV3 `webRequest` only:
  no blocking listeners, no `filterResponseData`, never a `response_inspected` event. Frame
  ancestry is reconstructed from `webNavigation` (bounded frame tree, 200 tabs × 300
  frames, rate-limited `getAllFrames` refresh). Third-party status is inferred by comparing
  registrable domains of the issuing document and the top frame and omitted when unknown.
  Private windows are excluded through a tab cache that fails closed; events before the
  cache is primed are queued (bounded) and replayed. Every event carries
  `no_response_body_access` and `url_classification_unavailable`.
- **Chromium app** (`apps/extension-chromium`). Service-worker manifest, `chrome` →
  `browser` shim loaded first in every bundle, generated PNG icons (dependency-free writer),
  manifest validator with a permission allowlist (`webRequest, webNavigation, storage,
alarms, unlimitedStorage, scripting`, `<all_urls>`), same strict CSP, build guard over all
  four bundles (`eval(`, `new Function(`, synthetic names in production).
- **Capability honesty.** Chromium declares `request_metadata, redirect_chain,
response_headers, response_size, frame_ancestry` (+ `page_signals` when the sensor is on).
  The engine reports the JavaScript-technique rules and the response branch of the NOAS
  rules as **not evaluable**; the dashboard shows this per rule. Nothing fakes body
  inspection.
- **Tooling.** `pnpm e2e:chromium` (headless Chromium, host-resolver rules that resolve only
  the six reserved fixture names and NXDOMAIN everything else, single `/all` fixture page
  because headless Chrome accepts one start URL), `pnpm eval:benign:chromium`, CI packages
  both builds, store texts and permission justifications in `docs/store-listing.md`.

## Verification

| Check                                             | Result                                                                                                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit + integration tests                          | 450 passed (28 files; sensor-chromium adds 53)                                                                                                                                               |
| Performance tests                                 | 4 passed                                                                                                                                                                                     |
| Typecheck, eslint, prettier, indicator validation | clean                                                                                                                                                                                        |
| Firefox `web-ext lint`                            | 0 errors, 0 warnings                                                                                                                                                                         |
| Chromium manifest validator                       | OK                                                                                                                                                                                           |
| Headless Firefox e2e (`pnpm e2e:firefox`)         | 11/11 after the refactor                                                                                                                                                                     |
| Headless Chromium 156 e2e (`pnpm e2e:chromium`)   | 9/9: indicator contacts, NOAS request, page sensor registered and reporting, `page.hidden_iframe_after_load`, dashboard rendered, **no** `js.*` detection, **no** `response_body_inspection` |
| Chromium benign-browsing run                      | see `docs/evaluations/2026-11-02-benign-chromium.md` (section below)                                                                                                                         |

Observed on Chromium in the fixture run: `known_infra.*` contacts, `ad_delivery.noas_request`,
`ad_delivery.nested_frame_to_indicator`, `correlation.noas_then_hidden_frame`, and a
`correlation.adfection_chain` at high priority completed through a page-signal step 2 with a
documented NOAS host as step 1, which is the designed Chromium path in the absence of body
inspection.

## Security review

Read-only Opus review of the Chromium sensor, the shared-core refactor, the Chromium app
and the e2e script: no critical or high findings. Fixed: the unnecessary `tabs` permission
(dropped; allowlist enforced), e2e DNS now fails closed (`MAP * ~NOTFOUND`), unpredictable
`mkdtemp` profile removed on exit, DevTools port flag removed, fixture killed on exit,
`error` handler for a missing binary, build guard extended to all bundles and `new Function`,
icon write awaited, `enabled()` honoured on completion/error events. Documented, not fixed:
hostnames from incognito tabs may transiently populate the frame tree when incognito access
is granted (never emitted or persisted); `pruneDescendants` cost on pathological deep frame
trees (bounded by the 300-frame cap).

## Gate 3

- Synthetic suite passes on the Chromium rule subset: **met** (headless Chromium 156).
- No faked body inspection: **met** (`no_response_body_access` on every event; capability
  set excludes inspection; `js.*` rules not evaluable).

## Carried forward

- Store submissions (AMO review, Chrome Web Store) and a manual check in branded Google
  Chrome, which ignores `--load-extension` for automated runs.
- From Phase 2: interactive benign session, signed indicator bundles, Firefox-profiler pass.

## Status classification

**Implemented and verified**: Chromium sensor and app in headless Chromium; shared core on
both browsers; capability gating in the dashboard (engine tests + e2e console); build and
manifest guards; CI packaging.

**Implemented but not verified**: behaviour in branded Google Chrome (manual load unpacked);
service-worker suspension/resume over long sessions; the UI consent flow on Chromium.

**Planned**: Phase 4 integrations (STIX 2.1 / SIEM export, Zero Breach import, Zeek/Suricata
companion rules, investigation workflow).
