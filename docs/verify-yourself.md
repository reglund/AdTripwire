# Verify it yourself

AdTripwire asks for broad permissions (it watches request metadata on every site), so you
should not have to take its privacy promises on trust. This page lists checks you can do in
about ten minutes, from the source tree or from the installed files. They do not depend on
who wrote the code, and that matters: see check 7.

You can also open Settings in the extension: the card "Check this yourself" shows the
manifest the browser actually loaded (version, policy, permissions).

## 1. The content security policy (both manifests)

`apps/extension-firefox/manifest.json` and `apps/extension-chromium/manifest.json` both set
`content_security_policy.extension_pages` to:

```
script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'none'; img-src 'self' data:; style-src 'self'
```

`connect-src 'none'` forbids the extension's own pages (popup, dashboard, options) from
making `fetch`, XHR, WebSocket or beacon connections. `script-src 'self'` allows only scripts
packaged in the extension, so no remote or inline code. The browser enforces this policy; the
extension's code cannot turn it off. Unpack the `.xpi` / `.zip` (it is a zip file) and read
`manifest.json` to confirm the installed copy matches. The policy is a declaration the
browser applies to the extension's pages and background code; check 3 is the independent
check on the code itself.

## 2. Permissions, one line each

| Permission                   | Browser           | Why                                                                                         |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `webRequest`                 | Firefox, Chromium | Observe request metadata (host, type, status, size) without changing it.                    |
| `webRequestBlocking`         | Firefox           | Firefox only allows a response `StreamFilter` from a blocking listener. Nothing is blocked. |
| `webRequestFilterResponse`   | Firefox           | Read a capped prefix of selected script responses, passed through unchanged.                |
| `storage`                    | Firefox, Chromium | Keep settings and detections on this device.                                                |
| `unlimitedStorage`           | Firefox, Chromium | Avoid the default quota being hit by the bounded local store; not a request for more data.  |
| `alarms`                     | Firefox, Chromium | Periodic retention sweeps.                                                                  |
| `scripting`                  | Firefox, Chromium | Register the opt-in page sensor at runtime; nothing is injected unless you enable it.       |
| `webNavigation`              | Firefox, Chromium | Frame ancestry (needed to tell ad frames from the page).                                    |
| host permission `<all_urls>` | Firefox, Chromium | Ads can appear on any site; without it nothing can be observed. Revocable in the browser.   |

Chromium has no `webRequestBlocking` or `webRequestFilterResponse` (no response inspection
there). The Firefox manifest also declares
`browser_specific_settings.gecko.data_collection_permissions.required: ["none"]`, which is the
extension telling Firefox it collects no data. Treat that as a declaration to check against
checks 1 and 3, not as proof.

## 3. No network code in the built bundles

```
pnpm install --frozen-lockfile && pnpm build
grep -nE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.sendBeacon' apps/extension-*/dist/*.js
```

Result of this command on a fresh `pnpm build` of v0.2.0 (run 2026-11-06), Firefox and
Chromium alike (line numbers differ by four):

- `fetch(`: no hits. `XMLHttpRequest`: no hits. `sendBeacon`: no hits. `popup.js`,
  `dashboard.js` and `page-sensor.js`: no hits at all.
- `WebSocket`: three hits per browser, all in `background.js` and all text, not a connection:
  a label string (`"js.websocket": "The script opens or references a WebSocket ..."`), the
  detector's regular expression `/\bWebSocket\b/` that looks for that word in scripts it
  inspects, and a rule description that mentions WebSocket. The extension scans other sites'
  scripts for these words; it does not call them. No `new WebSocket` appears.

Read those three lines yourself rather than taking this summary. The build also fails
(`apps/extension-*/build.mjs`, "Build guard") if `fetch(`, `XMLHttpRequest`, `new WebSocket(` or
loopback addresses show up in any bundle of a default build.

The optional `--assist` build (local model on `127.0.0.1`, see `docs/local-assist.md`) is a
separate, non-default variant: its manifest has `connect-src http://127.0.0.1:*` and its
`dashboard.js` contains two `fetch(` calls. It is not what the standard release zips contain;
check that your installed manifest says `connect-src 'none'`.

## 4. Zero runtime dependencies, no `eval`

`apps/extension-firefox/package.json` and `apps/extension-chromium/package.json` list only
`workspace:*` packages from this repository under `dependencies`; every third-party package is
a `devDependency` used at build time. `release:check` writes an SBOM
(`sbom.cdx.json`) stating zero runtime dependencies. The same build guard rejects `eval(` and
`new Function(` in all bundles (string literals excluded). The word `eval` does appear in the
bundles inside description text of the detector; `grep -nE '\beval\s*\(' apps/*/dist/*.js`
matches only that text, never a call.

## 5. What is stored, and how to look at it

Full list: `docs/privacy.md` ("Data stored (by key)"). The three that matter most:

- `detections`: the findings (rule, summary, evidence text, hostnames), kept 7 days by default.
- `events`: sanitized events a detection refers to (hostname, path pattern, query parameter
  names only, never values), kept with their detection.
- `daily`: per-day counts and documented hostnames for the calendar, kept 400 days; no URL or
  timestamp of any page you visited.

Look at it: Firefox `about:debugging#/runtime/this-firefox` > AdTripwire > Inspect > Storage

> Extension Storage (Chromium: `chrome://extensions` > Details > service worker > Inspect >
> Application > Extension storage). Delete it: Settings > Delete data, or remove the extension.

## 6. Reproducible build

```
pnpm install --frozen-lockfile
pnpm release:check      # builds twice, verifies byte-identity, writes dist-release/ + SHA256SUMS
```

The commands and steps are in `docs/release.md`. The v0.2.0 extension zips and SBOM built in CI
matched the locally built `SHA256SUMS` byte for byte; the v0.2.0 source archive did not (its
contents match, its hash does not), as `docs/release.md` explains. Build it yourself, compare
checksums with the GitHub release, and diff `dist/` against what you installed.

## 7. How this code was made

The code is largely written by AI models under the maintainer's direction. The reviews and
tests are also written by models. The maintainer is the human in the loop, not a reader of
every line: nobody has read every line. Nothing above depends on who wrote the code: the
policy is enforced by the browser, the permissions are in the manifest, and the grep and the
build guard run on the built output.

If you want to spend an hour: read the manifest, `apps/extension-firefox/src/background.ts`
(and the Chromium entry), and `docs/privacy.md`, and compare them with what the extension
does. Report findings, including "this claim is not true", as an issue at
https://github.com/reglund/AdTripwire/issues; for something sensitive follow `SECURITY.md`.

## Wording

AdTripwire reports observed traffic and documented infrastructure. It does not say a device
is infected, spied on, clean or safe, and nothing here is evidence of that either way.
