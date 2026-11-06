# AMO submission guide (Firefox Add-ons)

Preparation only; nothing here has been submitted. Written 2026-11-06 against v0.2.0 at commit
`a0b3d00`. Policy basis: Mozilla's Add-on Policies and Developer Agreement as I know them
(training knowledge, mid-2026; **no live fetch, no policy version or date verified**). Anything
marked "check on the AMO form" is a Mozilla requirement I could not confirm.

## Blockers before you click submit

- **The code repository is private.** The manifest `homepage_url`
  (`https://github.com/reglund/AdTripwire`), the issue links in `docs/verify-yourself.md` and the
  Settings card all point to it. Either make it public first (`docs/go-public-checklist.md`) or
  change `homepage_url` and use the observatory page below as homepage and support URL. The
  listing says "open-source"; that is not checkable by a visitor while the repository is private.
- **Bump the version** (section 6), commit, and only then build: the source archive is made from
  the committed tree and refuses to run on a dirty one.

## 1. What to upload

- **Upload `dist-release/adtripwire-firefox-<v>.zip`** from `pnpm release:check`, as a **listed**
  add-on (public page, Mozilla review, automatic updates). Self-distribution (unlisted) would
  also get a signature, but gives no discoverability and no store review signal; for a tool that
  asks for `<all_urls>`, listed is the better fit.
- **Do not upload** `apps/extension-firefox/web-ext-artifacts/*.zip` (`pnpm ext:package`). web-ext
  stores file mtimes, so it is not byte-reproducible: the same commit gave `82e15419…` in a clean
  clone and `fe6cd7ed…` in the main checkout (same file contents, different bytes).
- The release zip is deterministic (sorted entries, fixed 1980-01-01 timestamps, `scripts/zip.mjs`).
  Hash it: `sha256sum dist-release/adtripwire-firefox-<v>.zip` (also listed in
  `dist-release/SHA256SUMS`). Compare with the `SHA256SUMS` the tag's `Release` workflow produced
  in CI (Ubuntu 24.04, Node 20) before uploading.
- Also upload `dist-release/adtripwire-source-<v>.zip` as the source package (section 2).
- Never upload the `-assist` zips.

## 2. Source code submission

AMO requires the source of any bundled (esbuild) code, with instructions that reproduce the
uploaded file. The archive (`adtripwire-source-<v>.zip`, folder `adtripwire-<v>/`) is `git ls-files`
of the tagged commit written by `scripts/release-package.mjs`, so it contains every tracked file
(359 at v0.2.0: sources, `pnpm-lock.yaml`, data JSON, docs, tests) and **no** `node_modules`,
`dist`, `dist-release`, `web-ext-artifacts` or `.git`. It can only be produced by
`pnpm release:check` / `release:package` in a clean git checkout; it cannot be re-made from the
archive itself (no `.git`).

Paste into the source-code instructions box (Appendix A has it as one block). Important: the
build must be run from the repository root; esbuild writes cwd-relative path comments
(`// packages/...` from the root, `// ../../packages/...` under `pnpm build`), so `pnpm build`
yields functionally equal but byte-different bundles. `docs/release.md` still says
`pnpm build` for reviewers; this document supersedes that line.

Verification record (2026-11-06, Linux, Node v20.20.2, pnpm 10.28.1, commit `a0b3d00`, v0.2.0):

| Route                                                                                           | Firefox zip SHA256 |
| ----------------------------------------------------------------------------------------------- | ------------------ |
| `pnpm release:check` in clean clone 1 (`.../amo-check/repo`)                                    | `d42be657…9226b2`  |
| `pnpm release:check` in clean clone 2 (other path); both `SHA256SUMS` files identical           | `d42be657…9226b2`  |
| Source archive unzipped, offline install, root-cwd `node apps/extension-firefox/build.mjs`, zip | `d42be657…9226b2`  |
| Main checkout (dirty tree), same root-cwd build and zip                                         | `d42be657…9226b2`  |
| `pnpm build` + `pnpm ext:package` (web-ext), clone vs main                                      | differ (see above) |

Full value: `d42be6576cbf35e3b6376eeaf22c7840c70672996ea4564bec2946b379dbfb19`. `diff -r` of the
unzipped release zip against each rebuilt `dist/` reported no differences. The v0.2.0 source
archive hash was `1a72e17b…` in both clones. These hashes are for v0.2.0 and will change with
the version bump and any commit; repeat the check for the real upload.

## 3. Listing text

Reuse `docs/store-listing.md` (long description, "what it does / does not do", permission table).

- **Name:** AdTripwire. **Summary** (limit 250 characters, check on the AMO form; the
  `store-listing.md` short description is 136):
  "Passive, local-only detection of advertising-based surveillance and spyware-delivery
  infrastructure. Shows observed traffic and evidence you can export. It does not block, send
  data anywhere, or tell you a device is clean." (222 characters)
- **Category:** Privacy & Security. **Tags:** security, privacy, advertising, surveillance,
  research (tag list and limits: check on the AMO form).
- **Homepage:** `https://reglund.github.io/adtripwire-observatory/` (public, returned HTTP 200).
  **Support URL:** must be public before submission; use the observatory page, or the GitHub
  issues URL once the repository is public. Support e-mail is optional.
- **License:** the repository is Apache-2.0; whether the AMO dropdown offers it or needs "custom
  license" with a link: check on the AMO form.
- **Screenshots:** AMO accepts PNG/JPG/GIF; use 1280x800 or larger (exact limits: check on the
  AMO form). Capture the dashboard views `#overview`, `#exposure`, `#detections`, `#settings`
  (the popup optional). No capture script exists in `scripts/` and none was written. Manual
  route: build `node apps/extension-firefox/build.mjs --dev`, run
  `node scripts/fixture-server.mjs 8787`, load with `pnpm ext:run`, browse the scenarios in
  `docs/testing.md`, open `moz-extension://<uuid>/dashboard.html#exposure` (uuid on
  `about:debugging#/runtime/this-firefox`) and use Firefox's screenshot tool. Capture
  `#settings` from a **production** build instead: its "Check this yourself" card shows the
  loaded manifest name, which reads "dev build" in the dev build. Do not use
  `scripts/exposure-run.mjs`; it belongs to the daily measurement.

## 4. Permissions justification (Notes to reviewer)

Source: `docs/verify-yourself.md` check 2. Appendix A has the paste-ready text. One line each:
`webRequest` (observe metadata, never change it), `webRequestBlocking` (Firefox only allows a
`StreamFilter` from a blocking listener; the single blocking listener is scoped to documented
indicator hosts and `/getAd` paths and passes bytes through unchanged; nothing is blocked),
`webRequestFilterResponse` (read a capped prefix of those responses), `storage` and
`unlimitedStorage` (bounded local store), `alarms` (retention sweeps), `scripting` (register the
opt-in page sensor at runtime; off by default), `webNavigation` (frame ancestry),
`<all_urls>` (ads can appear on any site). Also: `data_collection_permissions` is
`required: ["none"]`; extension-page CSP has `connect-src 'none'` and `script-src 'self'`; zero
runtime dependencies; no remote code, `eval` or `new Function` (build guard); the `--assist`
build (loopback model runtime) is **not** what is submitted.

## 5. Privacy policy

AMO asks whether the add-on collects data and may ask for a policy URL or text. Paste the text
in Appendix B. Declared collection: none. Where the policy lives (listing field vs. link): check
on the AMO form.

## 6. Version and ID

- `browser_specific_settings.gecko.id`: `adtripwire@reglund.github.io` (fixed forever for this
  listing; do not change it). `strict_min_version`: `128.0`. `data_collection_permissions` is
  honoured from Firefox 140 (desktop) and 142 (Android) as I recall; whether AMO accepts it with
  a 128 minimum: `web-ext lint` gave 0 errors, 0 warnings, but check on the AMO form.
- The manifest's own `version` (0.1.0) is overwritten at build from
  `apps/extension-firefox/package.json`; bump the `package.json` files, not the manifest
  (`docs/release.md` step 1).
- AMO rejects a version number it has already seen. **Recommendation: submit 0.3.0.** Current
  HEAD differs from the published v0.2.0 tag (Exposure view, badge, calendar, observatory notes,
  Settings card, export fix; see CHANGELOG Unreleased), so a 0.2.0 from HEAD would not match the
  GitHub v0.2.0 zips, and the v0.2.0 source archive hash is not reproducible anyway. Move
  Unreleased into a `[0.3.0]` section, tag `v0.3.0`, let CI rebuild.

## 7. Checklist

1. [ ] Decide public repo vs observatory-only URLs; fix `homepage_url` if needed.
2. [ ] Bump version to 0.3.0 (package.json files), move CHANGELOG Unreleased to `[0.3.0]`.
3. [ ] `pnpm observatory:snapshot`, review and commit; commit everything (clean tree).
4. [ ] `pnpm release:check`; record `SHA256SUMS`.
5. [ ] Tag `v0.3.0`, push; compare CI `SHA256SUMS` with the local one.
6. [ ] Verify the source archive (Appendix A, steps 1-6) and the firefox zip hash.
7. [ ] Take four screenshots (section 3).
8. [ ] AMO: upload firefox zip (listed), answer data-collection (none), paste summary, description, categories, URLs, privacy text.
9. [ ] Upload the source archive and paste the Appendix A notes.
10. [ ] Submit, then watch the developer e-mail and the AMO reviewer thread; answer reviewer questions and re-upload only with a new version number.

## Appendix A: source instructions and Notes to reviewer (paste)

```
Build environment: Linux (Ubuntu 24.04 in CI), Node.js 20 (tested v20.20.2), pnpm 10.28.1
(package.json "packageManager"; `corepack enable` or `npm i -g pnpm@10.28.1`). Network
access to the npm registry is needed for the install.

1. unzip adtripwire-source-<v>.zip && cd adtripwire-<v>
2. pnpm install --frozen-lockfile
3. node apps/extension-firefox/build.mjs      (run from this directory; not `pnpm build`:
   esbuild embeds cwd-relative path comments, so other working directories give different
   bytes). Output: apps/extension-firefox/dist
4. mkdir /tmp/up && unzip -q <uploaded adtripwire-firefox-<v>.zip> -d /tmp/up
5. diff -r /tmp/up apps/extension-firefox/dist     (expected: no output)
6. Optional, whole-zip hash: the uploaded zip is written with scripts/zip.mjs (sorted entries,
   fixed timestamps):
   node --input-type=module -e 'import {buildZip} from "./scripts/zip.mjs"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; const d="apps/extension-firefox/dist"; const w=(p)=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?w(path.join(p,e.name)):[path.join(p,e.name)]); const z=buildZip(w(d).map(f=>({path:path.relative(d,f).split(path.sep).join("/"),data:fs.readFileSync(f)}))); console.log(crypto.createHash("sha256").update(z).digest("hex"))'
   and compare with `sha256sum <uploaded zip>`. `unzip -l` lists the same 10 files.
The bundles are not minified (esbuild, minify: false). Entry points: apps/extension-firefox/src/
{background,popup,dashboard,page-sensor}.ts. Do not use the --dev, --eval or --assist flags;
the submitted build is the default one.

Notes to reviewer
- AdTripwire passively observes request metadata to find documented advertising-surveillance
  infrastructure (public indicator list, in packages/indicators/data). It never blocks, modifies
  or redirects traffic and makes no network request of its own.
- Manifest: data_collection_permissions required ["none"]; extension-page CSP
  "script-src 'self'; ... connect-src 'none'". Zero runtime dependencies, no remote code, no
  eval/new Function (the build fails if any appears). The --assist variant (loopback model
  runtime) is a separate build and is not submitted.
- webRequest: observe host/type/status/size. webRequestBlocking + webRequestFilterResponse:
  Firefox permits a StreamFilter only from a blocking listener; the one blocking listener is
  scoped to indicator hosts and /getAd paths, writes the bytes through unchanged first, caps
  the prefix inspected, and keeps only marker ids, never source text.
- <all_urls>: ads can appear on any site. storage/unlimitedStorage: bounded local store
  (detections 7 days by default). alarms: retention sweeps. webNavigation: frame ancestry.
  scripting: registers the opt-in page sensor content script at runtime; off by default.
- No data leaves the device; exports are redacted JSON saved only on user action.
- Checks you can repeat: docs/verify-yourself.md (CSP, permissions, grep for network code).
```

## Appendix B: privacy policy text (paste)

```
AdTripwire does not collect, transmit or share any data. It makes no network requests of its
own: no telemetry, analytics, accounts or remote lookups, and its pages run under a content
security policy that forbids connections (connect-src 'none').

What it keeps, on your device only (browser extension storage): your settings; detection
records (rule, summary, evidence text, hostnames) and the sanitized request events they refer
to (scheme, hostname, a path pattern and query parameter names, never query values,
fragments or credentials); per-hostname day counters for documented infrastructure; aggregate
counters; and per-day counters (number of pages, number of third-party domains per page, number
of contacts with documented infrastructure), without any page address. It does not store
cookies, tokens, page content or a browsing history, and private windows are excluded by
default. Detections are kept 7 days by default (configurable), day counters 400 days.

Export happens only when you press the export button; the file is saved on your device and is
not sent anywhere by AdTripwire. What you do with it is your choice.

Delete: Settings > "Delete all collected data", or remove the extension.

Results describe observed traffic and documented infrastructure. They do not show that a device
is clean or compromised. Details you can check: docs/privacy.md and docs/verify-yourself.md in
the source package.
```
