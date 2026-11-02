# Release procedure

Releases are reproducible: the same commit yields byte-identical zips on any machine with
the lockfile's Node 20 / esbuild versions, because the packager writes zips itself with
sorted entries and fixed timestamps (`scripts/zip.mjs`) instead of relying on file mtimes.

## Steps

1. Update `CHANGELOG.md`; bump `version` in `package.json` and `apps/*/package.json`
   (the manifests take their version from the app package).
2. `pnpm release:check` — builds default and `--assist` variants for Firefox and Chromium
   twice, verifies byte-identity, then writes `dist-release/`:
   - `adtripwire-firefox-<v>.zip`, `adtripwire-chromium-<v>.zip`
   - `adtripwire-firefox-assist-<v>.zip`, `adtripwire-chromium-assist-<v>.zip`
   - `adtripwire-source-<v>.zip` (git archive of HEAD, for store source review)
   - `sbom.cdx.json` (CycloneDX 1.5: product, bundled data, build toolchain; zero runtime deps)
   - `SHA256SUMS`
3. Commit, tag `v<version>`, push the tag. The `Release` workflow repeats every check, runs
   the reproducibility check in CI, and attaches the artifacts to a **draft** GitHub release.
   Compare `SHA256SUMS` from CI with the local one before publishing: they must match.
4. If the curated indicator set changed, publish a signed bundle as well:
   `pnpm indicators:sign sign --key <private key> --key-id adtripwire-2026a --changelog "…"`
   → `feeds/adtripwire-indicators-<set version>.signed.json`, verified by
   `tests/integration/signed-feed.test.ts`.

## Store submission (manual, needs maintainer accounts)

- **AMO (Firefox):** upload `adtripwire-firefox-<v>.zip` as a listed add-on; AMO requires the
  source archive because the bundle is built: upload `adtripwire-source-<v>.zip` and point
  reviewers to `docs/release.md` (build: `pnpm install --frozen-lockfile && pnpm build`,
  Node 20, pnpm 10). Listing texts and permission justifications: `docs/store-listing.md`.
  `web-ext sign --channel listed` can automate the upload with AMO API credentials.
- **Chrome Web Store:** upload `adtripwire-chromium-<v>.zip`; the listing must state the
  reduced capabilities (no response-body inspection) as in `docs/browser-capabilities.md`.
- The `--assist` variants are separate listings or self-distributed builds; their listing
  must disclose the loopback-only connection (`docs/local-assist.md`).

## Not done in this repository

Store accounts, signing credentials and the actual uploads belong to the maintainer; none of
this has been executed here. The release workflow has not been exercised on GitHub yet (no
tag pushed); it runs the same commands as `pnpm release:check` locally.
