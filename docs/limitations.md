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

## Engineering

- Firefox only. Chromium cannot inspect bodies with MV3; a Chromium sensor would run a
  reduced rule set.
- Event-page restarts: the correlation window is snapshotted every ~2 s to
  `storage.session`; a chain spanning a restart within that gap may be missed.
- Browser-level end-to-end tests are manual (see `docs/testing.md`); CI covers unit and
  synthetic integration tests only.
- No public-suffix list: a two-label suffix such as `co.uk` could pass indicator
  validation as a domain; the curated set contains none.
