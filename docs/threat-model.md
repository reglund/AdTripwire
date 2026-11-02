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

## Local-model assistance (Phase 5, optional build)

Threats introduced by letting a model read evidence, and how the design answers them:

| Threat                                                      | Answer                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model declares the device infected or safe                  | Sentence-level screen removes verdict claims (EN/NB), shows the removal, labels the rest as interpretation; detection severity and evidence are displayed from the deterministic record and cannot be changed by the model.                                     |
| Prompt injection through attacker-chosen hostnames or paths | Context is allowlisted and re-sanitized (hostname grammar, reduced path charset); evidence is fenced as data; the system prompt forbids following it; instruction echoes are flagged; an injection scenario is part of the evaluation.                          |
| Model invents infrastructure or victims                     | Hostname tokens absent from the evidence are masked; the evidence list beside the answer is the reference.                                                                                                                                                      |
| Data leaves the device                                      | Only `--assist` builds can connect, and only to `http://127.0.0.1:*` (CSP + provider check; `localhost` is deliberately not allowed); default build has `connect-src 'none'` and the build guard rejects any loopback code path. Notes never enter the context. |
| Another local process impersonates the runtime              | It would receive sanitized hostnames, path patterns and rule text only. The port is user-chosen; the probe shows which models answer.                                                                                                                           |
| Model output persisted or exported as evidence              | Never stored; not part of evidence, STIX, SIEM or hand-off exports. A person may copy text into a note deliberately, which is their authored content.                                                                                                           |
| Resource exhaustion by a slow or verbose runtime            | 90 s timeout, 256 KB response cap, 600-token `num_predict`, 3 000-character display cap.                                                                                                                                                                        |

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

### Phase 4 review (2026-11-02)

Read-only Opus review of the import path and the new request parsing (exports and feeds were
not reached and remain covered by the interop package's own tests). Findings fixed the same
day: a host-independent `url_path` indicator of `/` would have matched every request (path
indicators now need a real path segment and `url_path` records are not accepted from imports
at all); public suffixes such as `co.uk` and shared-platform tenants passed as `domain`
records (now rejected via the bundled Public Suffix List and an extended platform denylist;
tenants must be exact `hostname` records, and the STIX importer maps them accordingly);
bundled precedence only caught identical strings (now also parents and children of bundled
indicators); unbounded set ids made imported sets impossible to remove (ids limited to
`[A-Za-z0-9._-]{1,128}`, string lengths capped); no cap on imported indicators (10 000 per
set, 5 000 total, 20 sets, eviction reported); stored imports are re-validated on load; the
Firefox inspection-pattern re-registration rolls back to the previous pattern set on failure.
Residual: imported classifications are still trusted within those limits, so an analyst can
import `domain` records for legitimate popular sites; the dashboard shows imported sets
separately and they can be disabled or removed at any time.

### Phase 5 review (2026-11-02)

Read-only Opus review of the Phase 5 diff (correlation package, assist layer, background
handlers, build flag; the evaluation script, mocks and docs were not reached). It confirmed
with real builds that the default bundles contain no `fetch` call and keep
`connect-src 'none'`, and that in `--assist` builds only the dashboard bundle can connect.
Findings fixed the same day: the hedge detector accepted any negation followed within three
words by a verb ("it is not hard to show that your device is compromised" passed) and now
accepts only fixed hedge phrases sitting directly before the claim, with hedged claims
flagged; claim patterns missed markdown emphasis, contractions, two-word adverbs, device
nouns, active voice, named spyware, zero-width characters and line-wrapped claims (output is
now normalised before screening and the patterns widened); IP literals, `//host`,
`ftp://host` and look-alike dots escaped hostname masking (now masked; `.md` no longer
treated as a file extension); the provider followed redirects (now `redirect: "error"`,
`credentials: "omit"`, `cache: "no-store"`, `referrerPolicy: "no-referrer"`, and redirected
responses are rejected); `localhost` was allowed by the CSP and provider (now 127.0.0.1
only); enum-like context fields were not re-sanitised and rule text could close the evidence
fence (fixed); stored assist settings were merged without validation (fixed); the build guard
now rejects `fetch`/`XMLHttpRequest`/`WebSocket`/`/api/` outside the assist dashboard; the
sensor now drops requests issued by extension pages so a model call can never become an
observed event (unit-tested; see also the `--assist` e2e). Clustering by shared hostname,
domain or indicator is now bounded to a 24 h proximity window (shared events still link
regardless) to limit chaining through common ad-platform domains. The real-model evaluation then
showed the opposite failure: all six sentences the first screen removed were legitimate
caveats, so the hedge detector was extended to the caveat forms models actually use while the
reviewer's fake-hedge attacks remain blocked (both encoded as tests). Residual: screening is
pattern-based and can be phrased around; the label, the side-by-side deterministic evidence
and the never-stored rule carry the guarantee.
