# Browser capability and visibility matrix

Verified against MDN on 2026-11-02. Rules declare the capabilities they need; the
engine reports rules with unmet capabilities as **not evaluable**.

| Capability                                            | Firefox (MV3, ≥128)                                                                                                             | Chromium (MV3)                                    | Source of truth                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------- |
| `request_metadata` (url, type, method, status)        | yes, `webRequest`                                                                                                               | yes (observational)                               | webRequest.onBeforeRequest / onCompleted |
| `redirect_chain`                                      | yes                                                                                                                             | yes                                               | onBeforeRedirect                         |
| `response_headers` / `response_size` (Content-Length) | yes, `responseHeaders` extraInfoSpec                                                                                            | yes                                               | onCompleted                              |
| `frame_ancestry` (`frameAncestors`)                   | **Firefox only**                                                                                                                | no (only parentFrameId / initiator)               | MDN onBeforeRequest details              |
| `third_party_flag` (`thirdParty`)                     | **Firefox only**                                                                                                                | no                                                | MDN                                      |
| `url_classification` (Tracking Protection flags)      | **Firefox only**, only when the host is in Firefox's lists                                                                      | no                                                | MDN onHeadersReceived                    |
| `response_body_inspection` (`filterResponseData`)     | **Firefox only**; needs `webRequestBlocking` + `webRequestFilterResponse` (MV3), filter created in a blocking `onBeforeRequest` | **no** (declarativeNetRequest cannot read bodies) | MDN filterResponseData                   |
| Background model                                      | event page (`background.scripts`), no service worker                                                                            | service worker                                    | MDN background key                       |
| Host permissions at install                           | granted at install from Firefox 127 (MV3); revocable by user at any time                                                        | prompt / optional                                 | Extension Workshop MV3 guide             |

## Consequences for AdTripwire

- Category B (selective JS response) and D (JavaScript techniques) are Firefox-only
  in Phase 1. On Chromium only a zero-vs-nonzero Content-Length signal would remain.
- Frame-depth and third-party heuristics degrade on Chromium to `frameId > 0`.
- Firefox classification flags are a _corroborating_ signal only; absence means
  "not listed", never "benign".
- The extension checks `permissions.contains({origins:["<all_urls>"]})` at runtime and
  shows "Permission required" with a grant button if the user revoked host access.

## Firefox StreamFilter contract used

- Filter created in the blocking `onBeforeRequest` listener (required for script
  byte-cache bypass).
- `ondata`: `write(event.data)` first, then buffer up to cap; at cap `disconnect()`.
- `onstop`: `disconnect()` (remaining data, if any, flows natively).
- `onerror`: `disconnect()` best-effort, log.
- A stream is never left without `disconnect()`/`close()`; analysis never runs inside a
  filter callback.
