# Research integration (Phase 4)

AdTripwire stays local-first; these integrations move evidence and indicators **out** of the
extension in standard formats, and let analysts bring curated indicators **in** from local
files. The extension still makes no network requests.

## Exports (dashboard → detection detail or Settings → Export all)

| Export           | Format                                                                                                                    | Use                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence JSON    | `adtripwire.evidence-export` 1.0.0, default or strict redaction                                                           | Incident response, reproducible record                                                                                                 |
| STIX 2.1 bundle  | `application/stix+json`; `indicator`, `observed-data`, `sighting`, `note`, `report`, `identity`, TLP:CLEAR marking        | MISP, OpenCTI, TIP ingestion; validated with the OASIS `stix2-validator` (ids are deterministic UUIDv5, flagged only under `--strict`) |
| SIEM NDJSON      | Elastic Common Schema 8.11 fields, one object per line; `event.dataset` `adtripwire.detection` / `adtripwire.observation` | Elastic, OpenSearch, Splunk (via JSON), any SIEM                                                                                       |
| Hand-off package | one JSON with README text, evidence, STIX bundle, analyst notes, capabilities                                             | Helplines and analysts                                                                                                                 |

All exports are sanitized: hostnames, path patterns and parameter names only; strict
redaction pseudonymises non-subject hostnames. `url.*` ECS fields never carry query values.

## Analyst workflow

- **Notes**: per-detection free text (≤ 4000 chars), stored locally, included in the hand-off
  package, pruned with the detection.
- **Timeline**: detections and their supporting events merged chronologically, filterable by
  tab and time window. Only events referenced by detections are kept.

## Imports (dashboard → Indicators → Import indicator set)

- Formats: AdTripwire indicator-set JSON, or a STIX 2.1 bundle (indicators with
  `domain-name:value` equality patterns; IPs, hashes and other patterns are skipped with a
  warning).
- Validation: identical to the bundled set (no IPs as domains, no shared-hosting apexes, no
  reserved test names, date sanity). Rejected records become warnings; the import fails only
  if nothing survives.
- **Bundled curation takes precedence**: imported records for hosts the bundled set already
  classifies are dropped with a warning. This matters for Zero Breach's STIX export, which
  labels every indicator `malicious-activity`, including hosts AdTripwire classifies as
  surveillance or contextual. Imports therefore add coverage (e.g. the 2021–2025 Candiru
  sets) without re-ranking common ad-tech exposure.
- Imported sets can be disabled or removed; Firefox response inspection patterns are updated
  live. Import is from local files only; no feed is ever fetched.

## Network-sensor feeds (`feeds/`, regenerated with `pnpm feeds:export`)

| File                              | Format                                                                                         | Notes                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `adtripwire-indicators.stix.json` | STIX 2.1 indicators for the bundled set                                                        | Deterministic; `valid_until` from `validTo`                                                 |
| `adtripwire.zeek-intel.tsv`       | Zeek Intelligence Framework                                                                    | `Intel::DOMAIN` matches exact names; apex entries do not cover subdomains in Zeek           |
| `adtripwire.suricata.rules`       | Suricata 7 rules: DNS, TLS SNI, HTTP Host per host; HTTP Host + URI prefix for path indicators | sids reserved per record from 9400000; structurally tested, not run against a live Suricata |

Exposure caveat applies to every feed: a hit on surveillance infrastructure means an ad slot
touched the operator's pipeline, not targeting or compromise.

## Zero Breach

Zero Breach scans browser artefacts offline for past contact with the same indicators; its
STIX export (`dist/adfection.stix.json`) imports into AdTripwire as described above (292
domain records, IPs and hashes skipped). The two tools are complementary: Zero Breach looks
backwards in time, AdTripwire observes going forward.
