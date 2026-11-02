# Privacy

AdTripwire processes sensitive browsing signals and must itself be trustworthy.

## Guarantees in this version

- **Local only.** No telemetry, analytics, accounts, remote indicator fetches or any
  outbound request initiated by the extension. The extension-page CSP sets
  `connect-src 'none'`. The separate `--assist` build variant (see
  `docs/local-assist.md`) relaxes this to loopback only (`http://127.0.0.1:*`) so a local model runtime on the same computer can be asked to
  explain evidence; even then nothing is sent unless assistance is enabled in settings and
  the person presses the button, and the exact text can be previewed first. Analyst notes
  are never part of that text, and model answers are never stored or exported.
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
| `settings`                | Monitoring, retention and (assist builds) local-assistance settings    |
| `signedIndicatorBundle`   | A verified signed indicator bundle chosen by the person, if any        |
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
