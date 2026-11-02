# Threat model

## What AdTripwire tries to detect

The AdFection technique (Citizen Lab, Confiant, 15 Oct 2026): a demand-side platform
wins an ad auction, the creative loads a script from a "NOAS"/`getAd` server, the server
decides per device (IP, identifiers) whether to return JavaScript, and selected devices
receive code that injects hidden iframes or further scripts leading toward validator and
command-and-control infrastructure operated by a spyware vendor.

Observable from a browser extension:

- hostnames and path patterns of requests from ad frames (NOAS, trackers, staging CDNs);
- frame ancestry and third-party status; Firefox tracking-protection classification;
- redirect chains; response status, size (Content-Length) and, on Firefox, the body of
  narrowly selected script responses;
- temporal relationships between these within a tab.

Not observable: in-page JavaScript execution (Phase 1 has no page instrumentation),
decrypted C2 payloads, exploitation success, anything after a browser exploit lands,
traffic from apps other than the browser, DNS resolution details.

## Adversaries considered against AdTripwire itself

| Adversary                          | Capability                                                                                 | Mitigation                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostile web page                   | Runs arbitrary JS in content; may try to message the extension or exhaust it with traffic. | No content scripts; `runtime.onMessage` accepts only the extension's own pages (sender id + URL check) and validates every payload. Bounded pending map, bounded correlation window, size-capped inspection buffer, and a global inspection budget (concurrent filters × per-filter cap ≤ 32 MB; excess requests are passed through uninspected with a recorded limitation). |
| Hostile response body              | Crafted script content aimed at the analyser (ReDoS, huge inputs, invalid UTF-8).          | Analysis is capped by bytes and chars, regexes are linear, decode failures are tolerated, the analyser runs deferred and exceptions are caught. Matched source text is never stored.                                                                                                                                                                                         |
| Malicious indicator file           | Overly broad or malformed indicators causing false positives or crashes.                   | Validation rejects IPs-as-domains, public shared-hosting apexes, bad dates, duplicates; no remote indicator loading in this version.                                                                                                                                                                                                                                         |
| Local attacker with profile access | Reads `storage.local`.                                                                     | Only sanitized hostnames, path patterns, parameter names and metadata are stored; no cookie values, query values, or full URLs. Retention defaults to 7 days.                                                                                                                                                                                                                |
| Supply chain                       | Compromised dependency.                                                                    | Zero runtime dependencies; dev dependencies audited in CI. No remote code; strict CSP.                                                                                                                                                                                                                                                                                       |

## Page sensor (Phase 2, opt-in)

The page sensor is an isolated-world content script registered dynamically
(`scripting.registerContentScripts`) only while the user has enabled it in Settings. It is
never shipped as a static content script.

| Property            | Design                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where it runs       | Sub-frames only (`window !== window.top`), `http(s)` documents, all sites; never top-level pages, never private windows (dropped in the background)                                                                                                                                                                                               |
| What it observes    | Structural facts after load: an inserted iframe that is hidden (≤ 2×2 px or `display:none`), an inserted third-party `<script src>`, an inserted 1×1 third-party `<img>`, and `message` events whose data has a `type` field (`analytics_sdk_ready` is the documented SDK marker)                                                                 |
| What it never reads | Page text, DOM content, form values, `document.cookie`, storage, full URLs (only hostnames), the message payload beyond the `type` string                                                                                                                                                                                                         |
| What it sends       | `{type:"page_signal", kind, targetHostname?, crossOrigin?, msSinceLoad?}`, capped at 40 signals per frame lifetime and inactive two minutes after load                                                                                                                                                                                            |
| Trust boundary      | The page can forge nothing about _where_ the signal came from: tab, frame id and frame URL come from the browser's `sender`. The payload is shape-validated (`buildPageSignalEvent`), hostnames are normalized, and a per-tab rate limit (120/min) bounds flooding. Messages from top-level frames or non-http frames are dropped before parsing. |
| Capability          | Adds `page_signals`; rules requiring it are "not evaluable" while the sensor is off                                                                                                                                                                                                                                                               |
| Residual risk       | A hostile frame can emit fake structural signals about itself; at most this yields detections scoped to that frame, which the correlation rules treat as corroboration, not as a chain on their own. Isolated-world scripts cannot see page-world monkey-patching, so signals are limited to DOM structure and message events.                    |

## Explicit non-goals in Phase 1

- Blocking or altering traffic.
- Attribution of a detection to a specific operator beyond the cited sources.
- Any claim that a device is compromised or clean.

## Independent review

An adversarial review of the sensor, background, sanitizer and engine was performed on
2026-11-02 (Opus reviewer, read-only). It confirmed the pass-through filter ordering,
message trust checks, persistence scope and CSP, and found two blocking issues that were
fixed the same day: a quadratic regex in the JavaScript analyser (ReDoS from a hostile
`/getAd` response) and a bypass that kept inspecting NOAS paths when the user had disabled
response inspection. Medium findings fixed: synchronous listener registration for the
event page, a global inspection budget, stricter snapshot validation, O(R) chain search
with a downgrade for first-party "NOAS" hosts, duplicate-pending handling, `close()` on
stream end, a deletion race, and sanitizer gaps for contact-like and JWT-like tokens.

### Phase 2 review (2026-11-02)

Two read-only Opus reviews covered the page sensor, lineage correlation, the JavaScript
code view, PSL, indicator validity and the evaluation scripts. No critical or high
findings. Fixed: a toggle race that could leave the page-sensor script registered after
opt-out (calls serialised, setting re-read), page-signal timestamps now carry the insertion
time so late-arriving signals complete chains, descendant scanning of inserted subtrees,
per-frame rate limiting, single-call frame ancestry with truncation marking, chains with a
page-signal step 2 capped at elevated unless step 1 is a documented NOAS host, the generic
typed-postMessage and plain late-script signals no longer produce stand-alone detections,
anchored parsing and no raw lines in console-derived evaluation reports, process-group
cleanup in the Firefox scripts, and the registrable-domain fallback for hosts that are
themselves public suffixes. Documented, not fixed: hidden-ness is judged at insertion time;
page signals can be forged by a hostile frame (bounded to that frame's lineage and capped
below high priority without a documented NOAS host); the code view can be steered by
crafted regex literals.
