# Privacy

AdTripwire processes sensitive browsing signals and must itself be trustworthy.

## Guarantees in this version

- **Local only.** No telemetry, analytics, accounts, remote indicator fetches or any
  outbound request initiated by the extension. The extension-page CSP sets
  `connect-src 'none'`.
- **Sanitized at the edge.** Every URL is reduced to scheme, hostname, a path pattern
  with token-like segments replaced by `{id}`/`{seg}`, and query parameter **names**.
  Query values, fragments and credentials are dropped before anything leaves the sensor.
- **Not a browsing history.** Top-level navigations are not recorded. Only third-party
  or framed requests, indicator matches and NOAS-pattern paths enter the in-memory
  correlation window (bounded, memory-only via `storage.session`). Only events
  referenced by a detection are persisted.
- **No secrets stored.** Cookie values, tokens, authentication material and page content
  are never read or stored. When a request carries parameter names like `cookie` or
  `idfa`, the _name_ and a category are recorded, never the value.
- **Response inspection is narrow.** Bodies are inspected only for indicator hosts and
  NOAS-pattern paths, capped in size, and only _marker identifiers_ (e.g.
  `js.new_function`) and bounded statistics are kept, never source text.
- **Private windows excluded** by default.
- **Page sensor is opt-in and structural.** Off by default. When enabled, an isolated content
  script runs only inside embedded sub-frames and reports hidden-iframe insertion, late
  third-party script/image insertion and a documented SDK message type. It never reads page
  text, form values, cookies or full URLs. See `docs/threat-model.md` → Page sensor.
- **Retention.** 7 days by default, with caps on detections and events; configurable.
  "Delete all collected data" clears `storage.local` and `storage.session`.
- **Exports are redacted.** The default profile keeps sanitized hostnames; the strict
  profile pseudonymises every hostname that is not a detection subject with a random,
  non-exported salt, drops tab ids and initiator origins, and reduces paths.

## Data stored (by key)

| Key                       | Content                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `settings`                | Monitoring and retention settings                                      |
| `detections`              | Detection records (summary, rule, evidence text, event ids, hostnames) |
| `events`                  | Sanitized events referenced by detections                              |
| `exposure`                | Per-hostname distinct-day counters for surveillance-classified hosts   |
| `metrics`                 | Aggregate counters and timing totals (no URLs)                         |
| session: `engineSnapshot` | Bounded correlation window and dedup state; cleared when Firefox exits |

## Permissions requested and why

| Permission                                       | Why                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `webRequest`                                     | Observe request metadata                                                                       |
| `webRequestBlocking`, `webRequestFilterResponse` | Required by Firefox to create a `StreamFilter` for pass-through inspection; nothing is blocked |
| `<all_urls>` host permission                     | Ads can appear on any site; without it nothing can be observed. Revocable at any time.         |
| `storage`, `unlimitedStorage`                    | Local persistence                                                                              |
| `alarms`                                         | Retention sweeps on an event page                                                              |
