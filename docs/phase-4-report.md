# Phase 4 report — Security research integration

Date: 2026-11-02 · Commits: `a1983e9` (integration), plus the hardening commit that includes
this report.

## What was built

- **STIX 2.1 export** (`@adtripwire/interop`): indicators as `indicator` SDOs with
  `domain-name`/`url` patterns and validity windows; detections as `observed-data`,
  `sighting`, `note` and a `report`, with an AdTripwire `identity` and TLP:CLEAR marking.
  Deterministic RFC 9562 UUIDv5 ids. Validated with the OASIS `stix2-validator` 3.3.1
  (`--enforce-refs` valid; `--strict` flags only the deliberate non-v4 ids).
- **STIX import**: `domain-name` equality patterns become indicator records; IPs, hashes and
  other patterns are skipped with warnings; every record passes the hardened validator;
  shared-platform tenants are imported as exact hostnames. Zero Breach's STIX export imports
  as 292 domain records.
- **SIEM export**: Elastic Common Schema 8.11 NDJSON for detections (`event.kind: alert`,
  `threat.indicator.*`, `threat.enrichments[]`, `adtripwire.*`) and supporting observations
  (`event.kind: event`, `url.domain`, `url.path` = sanitized path pattern).
- **Network-sensor feeds** (`feeds/`, `pnpm feeds:export`): STIX indicators, Zeek Intel TSV
  and 497 Suricata rules (DNS, TLS SNI, HTTP Host per host; Host+URI for path indicators),
  byte-identical across runs.
- **Investigation workflow**: analyst notes per detection (local, pruned with the detection),
  a Timeline tab merging detections and supporting events, and a hand-off package (evidence
  - STIX + notes + plain-language README) for helplines and analysts.
- **Indicator imports in the dashboard**: local JSON or STIX files, validated, bundled
  curation takes precedence (exact, parent and child overlaps), sets can be disabled or
  removed, Firefox inspection patterns update live with rollback on failure.

## Verification

| Check                                             | Result                                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit + integration tests                          | 513 passed (36 files; interop adds 38, import policy and validator hardening add more)                                                             |
| Performance tests                                 | 4 passed                                                                                                                                           |
| Typecheck, eslint, prettier, indicator validation | clean                                                                                                                                              |
| `pnpm feeds:export`                               | 167 STIX indicators, 167 Zeek entries, 497 Suricata rules; deterministic                                                                           |
| OASIS STIX validator                              | valid (run by the interop author from a scratch venv)                                                                                              |
| Headless Firefox e2e                              | 11/11                                                                                                                                              |
| Headless Chromium e2e                             | 9/9                                                                                                                                                |
| Suricata `-T` on the generated rules              | **not run**: no local Suricata; the container run was blocked by the environment's permission policy. Command documented in `docs/integration.md`. |
| Live ingestion into a SIEM                        | **not performed**; ECS structure covered by tests                                                                                                  |

## Security review

Read-only Opus review of the import path found two high and several medium issues, all fixed
(see `docs/threat-model.md` → Phase 4 review): host-independent path indicators, public
suffixes and platform tenants as `domain` records, bypassable precedence, unremovable sets,
unbounded import sizes, no rollback on listener re-registration. Exports and feeds were not
reached by the reviewer and rest on the interop package's injection and leakage tests.

## Gate 4

- Exported bundle round-trips into a STIX validator: **met**.
- SIEM test harness: **partially met** (ECS structure tested; live ingestion pending).

## Carried forward

Suricata/Zeek execution check, live SIEM ingestion, review of exports/feeds, manual UI
verification of notes/timeline/import views, signed indicator bundles (design in
`docs/indicator-updates.md`), interactive benign session, store submissions.

## Status classification

**Implemented and verified**: STIX export validity, STIX import of Zero Breach-shaped data,
ECS structure, feed generation and determinism, import validation and precedence, notes and
timeline storage logic, both browsers' e2e after the changes.

**Implemented but not verified**: Suricata/Zeek rule execution, SIEM ingestion, the new UI
views in a browser (helpers are unit-tested; views type-checked).

**Planned**: Phase 5 local correlation assistance.
