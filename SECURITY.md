# Security policy

AdTripwire processes sensitive browsing signals. Its own security matters as much as its
detections.

## Reporting a vulnerability

Please report privately via GitHub Security Advisories on
https://github.com/reglund/AdTripwire/security/advisories/new. Do not open a public
issue for security problems. You should receive an acknowledgement within 7 days.

In scope: anything that lets a web page influence the extension's privileged context,
leaks stored data, stores data the privacy policy says is never stored, stalls or
corrupts a response stream, exhausts memory, or lets a crafted indicator file cause
false attribution.

## Design commitments

- No remote code, no `eval`, strict extension-page CSP (`script-src 'self'`,
  `connect-src 'none'`).
- No content scripts in Phase 1. Messages are accepted only from the extension's own
  pages and are shape-validated.
- Response inspection is pass-through only: every byte is written downstream unmodified
  before it is examined; buffering and analysis are size-capped and run off the
  response path.
- Zero runtime dependencies. Dev dependencies are audited in CI.
- Indicator files are validated; overly broad patterns (shared-hosting apexes, IPs as
  domains) are rejected.

## Coordinated disclosure for detections

If you believe AdTripwire has observed genuine spyware-delivery activity, do not contact
the infrastructure. Export the evidence and reach out to a trusted organisation such as
Access Now's Digital Security Helpline or The Citizen Lab.
