# Indicator updates — design (Phase 2 deliverable, not yet implemented)

AdTripwire ships a bundled, reviewed indicator set and makes no network requests. This
document specifies how optional indicator updates will work when they are introduced, so
that the data model and validation already in place (`validateIndicatorSet`,
`validFrom`/`validTo`, set `meta.version`) carry over without a rewrite.

## Goals

- Offline by default. Updating is opt-in and user-initiated or on a user-chosen schedule.
- Integrity: a bundle is applied only if its signature verifies against a public key
  pinned in the extension. No TLS-only trust.
- Provenance: every indicator keeps `source`, `sourceUrl`, `firstReported`, `lastReviewed`,
  `validFrom`/`validTo`; every bundle carries a changelog.
- Validation: the same `validateIndicatorSet` rules (no IPs as domains, no shared-hosting
  apexes, reserved names only in synthetic sets, date sanity) run before activation.
- Rollback: the previously active bundle is retained and can be restored in one click.
- Transparency: the dashboard shows active bundle version, signer, fetch time and the diff
  (added / removed / reclassified indicators) before the user confirms activation.

## Bundle format

```
adtripwire-indicators-<version>.json      the IndicatorSet[] payload (canonical JSON, sorted keys)
adtripwire-indicators-<version>.sig       detached Ed25519 signature over the payload bytes
adtripwire-indicators-<version>.meta.json { version, createdAt, keyId, sha256, changelog[] }
```

- Canonical JSON (RFC 8785 style: sorted keys, no insignificant whitespace) so the hash is
  reproducible from the data alone.
- Ed25519 via WebCrypto (`crypto.subtle`, algorithm `Ed25519`, available in Firefox 130+;
  fall back to refusing updates on older builds rather than to weaker verification).
- Key pinning: one or more public keys embedded in the extension with `keyId`s; rotation
  is done by shipping a new extension version that trusts both old and new keys for a
  period. A compromised key is revoked by the same path.
- Version monotonicity: a bundle is rejected if `version` is not greater than the active
  version (prevents replay of old bundles).

## Flow

1. User clicks "Check for indicator updates" (or enables a daily check). The extension
   fetches `meta.json` from a configurable, HTTPS-only base URL (default: the project's
   release endpoint). This is the only network request the extension will ever make, it
   carries no identifiers, and `connect-src` in the CSP is extended to exactly that origin.
2. If `version` is newer, fetch payload and signature; verify `sha256(payload) ==
meta.sha256` and the Ed25519 signature; run `validateIndicatorSet`; compute the diff.
3. Show the diff and changelog; require explicit confirmation to activate.
4. Activate atomically: store `{ active, previous }` in `storage.local`; rebuild the
   matcher and the blocking-listener match patterns (requires re-registering the
   `onBeforeRequest` listener with new URL patterns, which is a documented limitation of
   static match patterns: the sensor must expose `updateInspectionPatterns()`).
5. Record `rulesetVersion` + bundle version in every detection from then on (already part
   of the export schema via `indicatorSets[]`).

## Threats and mitigations

| Threat                                         | Mitigation                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Malicious or compromised update server         | Signature + pinned key; validation; user confirmation with diff                                                    |
| Replay of an old bundle with lapsed indicators | Version monotonicity; `validTo` already discounts expired indicators                                               |
| Overly broad indicator slipped into a bundle   | `validateIndicatorSet` deny-lists shared-hosting apexes and IPs-as-domains; diff review surfaces reclassifications |
| Tracking users via update checks               | No identifiers, no cookies, fixed cadence chosen by user, request body empty; documented in privacy.md             |
| Breaking the extension with a bad bundle       | Previous bundle retained; one-click rollback; validation failure leaves the active bundle untouched                |

## Out of scope for now

Live threat-intelligence feeds (STIX/TAXII) remain Phase 4; this design is only for the
project's own curated bundle.
