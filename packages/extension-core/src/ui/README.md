# Extension UI

Vanilla TypeScript and DOM; no framework and no runtime dependencies. Text from the background is
only ever inserted with `textContent` / `createElement`, never `innerHTML`. Everything shown comes from
the background through `rpc()` in `rpc.ts`; if it is unreachable each page renders an error state.

Bundles: `popup.ts` -> `dist/popup.js`, `dashboard.ts` -> `dist/dashboard.js`. Static files are in
`../../public/` (`popup.html`, `dashboard.html`, `styles.css`, `icons/`).

## Pages and `UiRequest`s

| Page            | Entry                            | Requests                                                                                   |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| Popup           | `popup.html`, `popup.ts`         | `get_status`, `get_settings`, `update_settings` (`{ enabled }`), `request_host_permission` |
| Dashboard shell | `dashboard.html`, `dashboard.ts` | none (router only)                                                                         |

## Dashboard hash routes

| Route                 | View                        | Requests                                                                                                                                                                                |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#overview` (default) | `views/overview.ts`         | `get_status` (incl. optional `metrics`), `list_detections` (`{ limit: 5 }`)                                                                                                             |
| `#detections`         | `views/detections.ts`       | `list_detections` (`DetectionFilter` built by `filter.ts`)                                                                                                                              |
| `#detection/<id>`     | `views/detection-detail.ts` | `get_detection` (`DetectionWithNote`), `get_events`, `set_detection_note`, `export_evidence` / `export_stix` / `export_siem` / `export_handoff` (all with `detectionIds: [id]`)         |
| `#timeline`           | `views/timeline.ts`         | `get_timeline` (`{ limit: 500, since?, tabId? }`)                                                                                                                                       |
| `#indicators`         | `views/indicators.ts`       | `get_status` (`indicatorSets`), `import_indicator_set`, `set_indicator_set_enabled`, `remove_indicator_set`                                                                             |
| `#rules`              | `views/rules.ts`            | `list_rules`                                                                                                                                                                            |
| `#settings`           | `views/settings.ts`         | `get_settings`, `get_status`, `update_settings`, `request_host_permission`, `export_evidence` / `export_stix` / `export_siem` / `export_handoff` (no `detectionIds`), `delete_all_data` |

## Assumptions about the background

- `list_detections` returns `Detection[]`; the UI sorts newest first, and the background should apply
  `limit` to the newest entries.
- Severity and confidence filters are "at least" selections, sent as the list of levels at or above
  the chosen one.
- `get_detection` returns a `Detection` (or `null` when unknown), `get_events` returns the stored
  `NormalizedEvent[]` (missing ids may be omitted), `export_evidence` returns an object or string
  that is saved verbatim as JSON.

## Research integration (analyst notes, exports, timeline, imports)

- `views/export-actions.ts` is the shared "Export" button group (detection detail: `detectionIds: [id]`;
  Settings: all). Evidence JSON keeps its original saving; STIX, SIEM and hand-off responses are
  `ExportFile` and are saved with `downloadText(filename, text, mediaType)` after `safeFilename`.
  STIX is always requested with `includeIndicators: true`. The redaction profile select applies to
  evidence JSON and the hand-off package only.
- Analyst notes: plain text in a `<textarea maxlength=4000>`; "Saved at" is the client clock at the time
  the `set_detection_note` call succeeded (the protocol returns no note timestamp).
- Timeline: oldest first, consecutive entries with the same `tabId` share a `<tbody>` with a "Tab N" label
  row. "Since" select maps to `since` (1 h / 24 h / 7 d; "all" omits it); the tab filter is a whole number.
  Pure helpers are in `timeline.ts`.
- Indicators: imported sets (`imported: true`) get an enable checkbox and a Remove button that needs a
  second click ("Confirm removal"). The import card reads the chosen file in the page with `FileReader`
  (max 5 MB) and sends its text; the UI never fetches anything. Pure helpers are in `exports.ts`.

## Helpers

- `format.ts`: labels, relative time, URL/size/ms formatting, visibility summary, validation, page-signal
  and sensor labels (`pageSignalLabel`, `sensorLabel`, `describePageSignal`), `metricRows`,
  `missingCapabilitiesText`.
- `exports.ts`: export/import/note helpers. `timeline.ts`: timeline filters and grouping.
- `filter.ts`: filter controls to `DetectionFilter`. `route.ts`: hash parsing. `dom.ts`: `h()` etc.

## Optional page sensor and runtime metrics

- Settings has an "Optional page sensor" card bound to `monitoring.pageSensorEnabled`. It is saved
  immediately through `update_settings` (not via "Save settings"). Turning it on first shows an inline
  consent explanation (what it does, what it never does) and requires a second click on "Enable page
  sensor"; turning it off is one click.
- Overview shows a "Runtime metrics" card only when `status.metrics` is present (aggregate counters, no URLs).
- Event sequence renders `page_signal` events: signal kind in words, target hostname when present, a
  "cross-origin" tag and time since load; every event row also names its sensor. Limitations such as
  `page_sensor_disabled` use the normal limitation text.
- Rules whose only missing capability is `page_signals` read "Requires the optional page sensor (Settings)".

Tests: `pnpm vitest run apps/extension-firefox`.
