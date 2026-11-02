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

| Adversary                          | Capability                                                                                 | Mitigation                                                                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostile web page                   | Runs arbitrary JS in content; may try to message the extension or exhaust it with traffic. | No content scripts; `runtime.onMessage` accepts only the extension's own pages (sender id + URL check) and validates every payload. Bounded pending map, bounded correlation window, size-capped inspection buffer. |
| Hostile response body              | Crafted script content aimed at the analyser (ReDoS, huge inputs, invalid UTF-8).          | Analysis is capped by bytes and chars, regexes are linear, decode failures are tolerated, the analyser runs deferred and exceptions are caught. Matched source text is never stored.                                |
| Malicious indicator file           | Overly broad or malformed indicators causing false positives or crashes.                   | Validation rejects IPs-as-domains, public shared-hosting apexes, bad dates, duplicates; no remote indicator loading in this version.                                                                                |
| Local attacker with profile access | Reads `storage.local`.                                                                     | Only sanitized hostnames, path patterns, parameter names and metadata are stored; no cookie values, query values, or full URLs. Retention defaults to 7 days.                                                       |
| Supply chain                       | Compromised dependency.                                                                    | Zero runtime dependencies; dev dependencies audited in CI. No remote code; strict CSP.                                                                                                                              |

## Explicit non-goals in Phase 1

- Blocking or altering traffic.
- Attribution of a detection to a specific operator beyond the cited sources.
- Any claim that a device is compromised or clean.
