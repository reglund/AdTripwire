# Known limitations

**Absence of detection is not evidence of absence.** AdTripwire sees a narrow slice of
what happens in a browser, and nothing outside it.

## Visibility

- No page-context instrumentation: in-page `eval`, `new Function`, `document.cookie`
  reads, WebRTC/WebSocket usage and fingerprinting API calls are **not** observed. They
  are only inferred when the _delivered script_ for an inspected request contains those
  constructs. Phase 2 may add an optional, isolated page sensor.
- Response bodies are inspected only for indicator hosts and NOAS-pattern paths. A
  payload served from an unknown host with an unknown path is not inspected.
- Content-Length is often missing (chunked/compressed); then the zero-byte signal relies
  on response inspection, which is Firefox-only.
- Firefox Tracking Protection flags depend on Disconnect lists; unlisted trackers are
  invisible to category C heuristics.
- Only ~2 of 305 Candiru validator domains are public; the indicator set cannot cover the
  rest. CloudFront staging hosts were rotated within days and are time-bounded.
- The bundled set is static. There is no update mechanism yet (planned with signatures).
- IP addresses are deliberately not matched (cloud reassignment); the browser mostly
  exposes hostnames anyway.

## Detection semantics

- A match on surveillance/tracking infrastructure indicates _exposure_, which the
  sources describe at a scale of billions of impressions. It is not targeting.
- A malicious-infrastructure match indicates contact with documented infrastructure,
  not confirmed execution or compromise.
- Temporal correlation does not prove causation; detections mark which links are
  observed and which inferred.
- Repeated exposure counts distinct days, not sessions; it is informational.

## Correlation and local-model assistance (Phase 5)

- Grouping links detections by shared hostname or registrable domain. Two unrelated ad
  incidents on the same publisher can therefore land in one group when a rule records the
  publisher among its subject hostnames; the "why grouped" list on the group page shows
  the exact links so this is visible.
- Suggested actions are templates keyed on cluster shape and sensor capabilities; they do
  not weigh the person's individual risk.
- Model explanations depend on the local model. Screening removes verdict sentences and
  masks unknown hostnames, but it is pattern-based: a model can phrase an unsupported
  conclusion in a way the patterns miss, and it can omit or soften relevant evidence.
  The deterministic evidence shown beside the answer is the reference, not the answer.
- Hostname masking can over-mask ordinary dotted words that look like hostnames and can
  under-mask when a model mentions only part of a name.
- The `--assist` build widens the CSP to loopback. Another local process listening on the
  configured port would receive the sanitized context; only hostnames, path patterns and
  rule text are at stake, never notes or values.
- Small local models (≈ 8–30 B parameters) were evaluated on synthetic scenarios only;
  see `docs/evaluations/assist-eval.md`. No browser-native on-device model API is used.

## Signed indicator bundles (Phase 6)

- Verification needs Ed25519 in WebCrypto: Firefox 130+ and Chromium 137+. Older builds
  refuse the bundle with a clear message and keep the built-in set.
- Bundles are imported from a file; there is no update check or download. Whoever publishes a
  bundle must also publish its SHA-256 and the person must obtain it over a channel they trust;
  the signature protects integrity and origin, not delivery.
- A single project key is pinned. Rotation requires an extension release.

## Engineering

- Firefox only. Chromium cannot inspect bodies with MV3; a Chromium sensor would run a
  reduced rule set.
- Event-page restarts: the correlation window is snapshotted every ~2 s to
  `storage.session`; a chain spanning a restart within that gap may be missed.
- Browser-level end-to-end tests are manual (see `docs/testing.md`); CI covers unit and
  synthetic integration tests only.
- No public-suffix list: a two-label suffix such as `co.uk` could pass indicator
  validation as a domain; the curated set contains none.
