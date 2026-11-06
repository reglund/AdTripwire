# Roadmap

## Where this goes next (written 2026-11-05)

Phases 1–6 built the instrument: a passive, local-only extension that notices when the
browser touches the ad-delivery infrastructure documented in the AdFection reports, keeps
the evidence, and never phones home. Since 2026-11-02 it has also run as a daily observatory
over 50 sites in four browser variants. In three days that produced five contacts with
documented hosts, all in Chromium, none in Firefox, on sports, Russian news and one British
newspaper.

The instrument works. The next phases are about **meaning**: turning a stream of
observations into something a person actually feels, uses and can share. Each phase below
has a _moment_ (what it feels like when it lands), what ships, why it is worth it, and a
gate. The order is by value to the person running it, not by engineering convenience. As
before, one phase at a time; nothing starts without an explicit go-ahead.

### The north star

> You open the browser in the morning and know, in one sentence, whether yesterday's web
> put you in the neighbourhood of the ad-surveillance pipeline. The evidence is one click
> away. Nobody else learned anything. And when you want to, you can show the world what
> ordinary browsing looks like from the inside.

Three promises hold through every phase, exactly as in `prompt.md`:

1. **Never phones home.** `connect-src 'none'` stays. Anything that reaches the network runs
   in the research harness on the maintainer's machine, never in the extension.
2. **Never a verdict.** Observed traffic and documented infrastructure; never "infected",
   "spied on" or "safe". Magic is in clarity, not in certainty we do not have.
3. **Never blocks or modifies.** It is a tripwire, not a wall.

### Phase 7 — The morning line (personal meaning) · size S–M ✅ delivered 2026-11-05

Report: `docs/phase-7-report.md`; plan and known limitations: `docs/phase-7-plan.md`. "Your
normal" shipped per day rather than per site (a per-site table would be a browsing history); no
new settings; the digest-vs-eval-JSON gate check is pending the next daily run.

**The moment.** The toolbar badge is quiet. You click it anyway and read: _"Yesterday: 214
pages, 0 contacts with documented infrastructure. Last contact 4 Nov, independent.co.uk,
via a Chromium ad slot."_ A small calendar shows the last 90 days, each day a dot: empty,
or marked. You can see at a glance that this is rare, and when it was not.

**What ships.**

- A daily digest computed locally from stored detections and the referenced events: pages
  seen, contacts with documented hosts, the one sentence, and "how it got there" (the story
  view already in d8628c3, now summarised).
- A 365-day exposure calendar in the dashboard (data already retained for a year in the
  eval profiles; retention for ordinary profiles becomes a setting, default 90 days).
- "Your normal": a per-site, on-device baseline of third-party domain counts, so the
  dashboard can say _"this page brought 48 third-party domains; your usual on this site is
  31"_. Shown as a change from your own history, never as a detection on its own.
- Norwegian bokmål for the digest and calendar text (rule text stays English until Phase 11).

**Why it matters to you.** Today the value is only visible in `trend.md` on one machine. This
puts it where you look every day, in the browser, for every profile you run the extension in.

**Gate 7.** The digest matches the JSON report for the same day on the eval profiles; the
calendar renders from a profile with a year of data within the dashboard's performance
budget; wording reviewed against the conservative-language rule; keyboard walkthrough done.

### Phase 8 — The observatory (public contribution) · size M ✅ delivered 2026-11-05

**The moment.** A page on the web, updated every evening by the timer, shows which sites and
which browsers put a generic visitor in contact with documented infrastructure, day by day,
since November 2026. You link to it in a post. A journalist links to it in an article.
Nothing on that page is about you: the profiles are synthetic by construction.

**What ships.**

- The daily service publishes `trend.md` and the per-run JSON (minus nothing: they contain
  no personal data) to a static site, e.g. GitHub Pages from a `data/` branch, via a push
  from the harness. The extension is untouched.
- A readable public view: documented hosts over time, sites that carried them, browser and
  device variants side by side (Chromium vs Firefox, desktop vs Pixel vs iPhone emulation),
  the "signals that matter" table, and a plain-language legend that repeats the exposure-not-
  targeting distinction every time.
- More site lists as variants: Norwegian daily sites, EU news, the Yandex-ad list, each a
  named profile in `scripts/systemd/`. New lists are proposed as PRs with a reason.
- A one-command "reproduce today's run" so anyone can verify a day's row on their own box.

**Delivered 2026-11-05.** Public dataset and page at
[reglund.github.io/adtripwire-observatory](https://reglund.github.io/adtripwire-observatory/)
(repository `reglund/adtripwire-observatory`), built and published by the daily service; eight
variants two at a time with Norway and Middle East/Africa lists; `pnpm observatory:reproduce`.
The data is published in full by decision (synthetic profiles). Report: `docs/phase-8-report.md`.
Deviation: "your normal" per-site baseline was never part of this phase; new site lists ship as
files in `tests/fixtures/`, not as PR-only proposals.

**Why it matters to you.** The daily runs already exist and already cost nothing to keep. This
turns them from a private cache into a citable, continuously updated public dataset on a
topic where almost no independent measurement exists, with your name on it.

**Gate 8.** The page is produced only from harness output; a reviewer confirms no field in
the published JSON can identify a person or device; a day's row reproduces from a clean
checkout within the stated tolerance; the legend passes the conservative-language rule.

### Phase 8b — Many rigs, one observatory · size M ✅ delivered 2026-11-06 (gate: first external rig pending)

**The moment.** Friends in other countries run the same daily harness on their own home or
mobile connections, each publishing under a rig name to its own directory; your rig aggregates
them into one page with a rigs table and a rig column on every signal. Vantage points, not
speed, are what raise the catch: datacentre IPs are filtered out of the auctions. Plan and trust
model in `docs/phase-8b-plan.md`; starts after Phase 8 is gated.

### Phase 9 — Your phone (mobile reality) · size M–L

**The moment.** The same tripwire runs in Firefox on your Android phone. The first week you
compare: the phone sees more ad-tech than the laptop, as the emulation runs predicted
(Pixel 5 emulation already shows the highest third-party counts and two of the five hits).

**What ships.**

- Firefox for Android build and AMO listing (Android-compatible manifest, popup and
  dashboard tuned for touch and small screens, StreamFilter availability checked at
  runtime and reported as a capability like on Chromium).
- A real-device exposure session protocol next to the emulated one, with results recorded in
  `docs/evaluations/`.
- Store presence as the delivery path: AMO and Chrome Web Store submissions (texts ready in
  `docs/store-listing.md`; needs the maintainer's accounts). This is the prerequisite for any
  phase where someone other than the maintainer installs it.

**Why it matters to you.** The campaign targeted mobile identifiers. The desktop numbers are
the lower bound. Running it on the device you actually carry is the most personally relevant
measurement the project can offer.

**Gate 9.** Synthetic suite passes on the Android capability subset; installed from AMO on a
real device; one exposure session recorded from that device.

### Phase 10 — Fresh eyes (living indicators) · size M

**The moment.** On a Monday the weekly refresh opens a pull request: upstream added nine
hosts. You merge, sign, and every installation that imports the bundle is current. In the
dashboard, a new tab "Seen alongside" lists hostnames that keep appearing in the same ad
slots as documented hosts, for a researcher to look at, never shown as detections.

**What ships.**

- Signed bundle publication on every merged indicator change: CI prepares the canonical
  bundle, the maintainer signs locally (key never leaves the machine), the release carries
  it. The in-app "set is older than 45 days" notice links to the bundle download.
- Co-occurrence observations: hostnames that share an auction chain or frame lineage with a
  documented host, counted across days, exported in the hand-off package and STIX bundle as
  _observations_. Purpose: give researchers candidates for the rotating staging hosts the
  reports could not enumerate. Explicitly not a rule, never a severity.
- Indicator review process in practice: a proposal template, provenance required, a second
  pair of eyes before merge, reserved-TLD separation enforced in CI (already in
  `pnpm indicators:validate`).

**Why it matters to you.** The indicator set is the project's expiry date. This makes staying
current a weekly habit instead of a chore, and turns your observatory into a source of leads
for the people who wrote the original reports.

**Gate 10.** A bundle round-trips: CI output verifies against the pinned key in both
browsers; co-occurrence export reviewed for privacy (hostnames only, sanitised, no paths);
a documented rule that co-occurrence never changes a detection's severity, with a test.

### Phase 11 — Ask the evidence (explanation that stays honest) · size M

**The moment.** You open a detection and press "Explain". A local model, on your machine
only, writes three sentences in Norwegian about what was observed, what it usually means and
what it does not mean. Every sentence is checked against the evidence before you see it.
You can hand the same package to Access Now's helpline in one click.

**What ships.**

- Norwegian explanations in the assist build (prompt templates, verdict screen already
  handles NB hedges), with the side-by-side evidence view as the guarantee.
- Rule text (summaries, significance, actions) in bokmål for the default build, so the
  non-assist installation is fully Norwegian.
- "Share with a specialist": the existing hand-off package with a cover note, the chosen
  redaction profile shown before export, and a checklist of what the recipient can and
  cannot conclude from it.

**Why it matters to you.** The evidence is already there; this phase makes it readable to
someone who is not you, in the language they think in, without the model ever being allowed
to say more than the evidence does.

**Gate 11.** Red-team cases for Norwegian verdict sentences pass; a native reader reviews
the rule text; the hand-off package validates in the STIX validator after the cover note is
added.

### Always on (no phase, no gate)

- The daily observatory keeps running and keeps accumulating. Three days is noise; three
  months is a dataset.
- Weekly indicator refresh (Mon 05:17 UTC) keeps opening PRs.
- Every change keeps the invariants: zero runtime dependencies, no `eval`, CSP unchanged,
  positive/negative/false-positive tests per rule, conservative wording.

### What this is not

Not an ad blocker, not an antivirus, not a compromise detector. If a future phase is only
possible by blocking traffic, adding a network call to the extension, or stating a verdict,
it is not on this roadmap.

## Delivered phases 1–6 (history)

Goal: anyone can install AdTripwire in Firefox, browse normally, and have it detect,
explain and preserve evidence of suspicious advertising-related activity, and security
researchers, journalists, NGOs and security teams can use that evidence. The phases follow
`prompt.md`. Each phase ends with a gate; the next phase does not start without an explicit
go-ahead.

Legend: ✅ done and verified · 🔶 implemented, not yet verified in a browser · ⬜ not started

## Phase 1 — Working Firefox MVP (delivered)

Milestone 1.1 Foundations ✅

- pnpm/TypeScript monorepo, strict types, shared contracts, CI, Apache-2.0.
- Curated indicator set (165 entries, CC0 data) with provenance and three
  classifications; validation script separates real and synthetic names.

Milestone 1.2 Core packages ✅

- indicators (matcher, validation), privacy (sanitizer, redaction, export),
  detection-engine (19 rules A–F, analyser, bounded window, dedup, exposure),
  sensor-firefox (observers, scoped pass-through StreamFilter).

Milestone 1.3 Extension integration ✅

- Background event page wiring sensor → engine → storage; validated messaging; popup
  and dashboard; manifest, build guard, `web-ext lint`.

Milestone 1.4 Verification 🔶

- Synthetic integration suite (benign ad, benign fingerprinting, IOC contact, NOAS
  empty/selected, hidden iframe, full chain, false positives, malformed/large responses,
  incomplete metadata, restart).
- Performance bounds (ingest throughput, window memory, analyser cost).
- Headless Firefox launch against the local fixture server (`pnpm e2e:firefox`), plus a documented manual procedure for UI flows.

Gate 1 (acceptance criteria, `prompt.md` §15): build + package, install, monitoring
operational, IOC + boundary matching, response inspection byte-for-byte, synthetic
suspicious event → visible detection, benign → no high priority, restart persistence,
deletion, redacted export, tests pass, README/limitations/privacy documented.

## Phase 2 — Enhanced behavioural detection (closed 2026-11-02 with approval; open items carried forward)

1. **Benign-browsing false-positive study** 🔶 — `pnpm eval:benign` automates a headless
   run over `tests/fixtures/benign-sites.txt`; results under `docs/evaluations/` (zero
   detections over 24 sites, ~3,200 observed requests). An interactive session following
   the protocol is still needed.
2. **Frame-lineage correlation** ✅ — chains anchored on frame lineage; tab-only chains
   downgraded one level with explicit inferred evidence.
3. **Context-aware JS analysis** ✅ — comment/string-blanked code view, marker proximity
   (4000 chars), minified-bundle baseline, fixed timer/iframe heuristics.
4. **Optional isolated page sensor** ✅ — opt-in content script in sub-frames, structural
   signals only, three `page.*` rules, threat model documented; verified in headless
   Firefox (`pnpm e2e:firefox`). `document.cookie` reads are not observable from an
   isolated world and are deliberately out of scope. UI consent flow is manual to verify.
5. **Public Suffix List** ✅ — bundled ICANN section (MPL-2.0 notice), used for
   registrable-domain logic in the engine.
6. **Indicator validity windows** ✅ (`validFrom`/`validTo`; expired matches lower
   confidence). **Signed indicator bundles** 🔶 — design in `docs/indicator-updates.md`;
   implementation pending, extension stays offline-only.
7. **Performance** 🔶 — runtime metrics card in the dashboard and a periodic aggregate
   stats line; Firefox-profiler measurement and adaptive caps pending.

Gate 2: documented false-positive rate on the benign protocol with zero high-priority
false positives (met for the headless run; interactive run pending), frame-lineage
correlation tested (met), page sensor reviewed (met, two reviews; see threat model).

Carried forward from Phase 2 (not blocking): interactive benign session, signed indicator
bundle implementation (`docs/indicator-updates.md`), Firefox-profiler performance pass,
manual verification of the page-sensor consent UI.

## Phase 3 — Chrome/Chromium support (delivered 2026-11-02, awaiting approval)

- `packages/sensor-chromium` ✅ — MV3 observational `webRequest`, frame tree from
  `webNavigation`, incognito handling via a tab cache, no inspection; 53 tests.
- Shared core ✅ — background, UI and page sensor moved to `packages/extension-core` behind a
  `SensorAdapter`; apps are manifest + build + entry files.
- `apps/extension-chromium` ✅ — service-worker manifest, `chrome`→`browser` shim, raster
  icons, manifest validator, CI package. Verified headless on Chromium 156
  (`pnpm e2e:chromium`): indicator and NOAS rules, page sensor, dashboard, no `js.*` rules.
- Dashboard explains non-evaluable rules on Chromium ✅ (engine capability gating).
- Store texts and permission justifications ✅ (`docs/store-listing.md`); Chromium
  benign-browsing run ✅ (zero detections, 24 sites); second-model review of the Chromium
  sensor ✅ (no critical/high; fixes applied). Pending: manual check in branded Google
  Chrome, store submissions.

Gate 3: synthetic suite passes on the Chromium rule subset (met headless); no faked body
inspection (met: `no_response_body_access` on every event).

## Phase 4 — Security research integration (delivered 2026-11-02, awaiting approval)

- STIX 2.1 export of detections and indicators ✅ (validated with the OASIS validator);
  STIX import of indicator bundles ✅ (bundled curation takes precedence).
- SIEM-compatible JSON ✅ (ECS 8.11 NDJSON for detections and observations).
- Zeek Intel and Suricata companion rules generated from the indicator set ✅ (`feeds/`,
  `pnpm feeds:export`; structurally tested, not executed in Suricata/Zeek).
- Zero Breach results: STIX import path ✅; on-device scan results have no stable public
  format yet ⬜.
- Investigation workflow ✅: analyst notes, timeline view, hand-off package.
- Security review of the import path ✅ (findings fixed; see threat model). Pending: run
  the Suricata rules through `suricata -T` (container run was blocked in this environment),
  review of exports/feeds beyond the package tests, manual UI verification of the new views.

Gate 4: an exported bundle round-trips into a STIX validator (met) and a SIEM test harness
(ECS structure tested; live ingestion into Elastic/OpenSearch not yet performed).

## Phase 5 — Advanced local correlation 🔶 (delivered 2026-11-02, awaiting approval)

- Deterministic correlation ✅: `@adtripwire/correlation` groups detections by shared
  requests, indicators, hostnames, registrable domains and same-tab proximity (union-find,
  linear), with a templated summary, timeline narrative and suggested investigative actions.
  New dashboard tab "Related activity" and group detail pages; detection pages link to their
  group.
- Optional local-model assistance ✅ (separate `--assist` build): loopback-only CSP and
  provider (Ollama-compatible `/api/chat`), explicit opt-in with preview of the exact text,
  allowlisted context (never notes), sentence-level verdict screen (EN/NB) with hedge
  detection, unknown-hostname masking, flags, labelling; answers never stored or exported.
  Default build keeps `connect-src 'none'` and the build guard rejects any loopback path.
- Verification ✅: 616 unit/integration tests incl. red-team guardrail cases; Firefox e2e 13/13
  and Chromium e2e 11/11 with the `--assist` build against a mock runtime (CSP, CORS, fetch,
  screening in the real browser); `eval:assist` against five real local models, report in
  `docs/evaluations/assist-eval.md`. Report: `docs/phase-5-report.md`.
- Security review of the Phase 5 diff (Opus); see the threat model's Phase 5 record.

Gate 5: red-team review of guardrails (done, findings fixed) and explanations evaluated
against rule evidence (done on synthetic scenarios with several local models; see the
evaluation report for the residual: screening is pattern-based and the label plus
side-by-side evidence carry the guarantee).

## Phase 6 — Release readiness ✅ (delivered and released 2026-11-02)

`prompt.md` defines Phases 1–5 only. Phase 6 is the remaining roadmap, approved to start on
2026-11-02: the cross-cutting items below plus what Phases 4–5 carried forward.

Milestone 6.1 Signed indicator bundles, offline

- Ed25519-signed bundle format (canonical JSON, SHA-256, key id), pinned project public key,
  verification in the import path via WebCrypto, version monotonicity, diff against the
  built-in set, one-click rollback to the built-in set. No network fetching: bundles are
  downloaded by the person and imported from a file, so `connect-src 'none'` stays.
- Maintainer tooling to generate keys and sign the generated dataset.

Milestone 6.2 Release engineering

- Deterministic packaging (sorted entries, fixed timestamps) for both browsers plus a source
  archive for store review; `SHA256SUMS`; CycloneDX SBOM; CHANGELOG; version 0.2.0.
- Tag-driven release workflow producing the artifacts; AMO/Chrome Web Store submission
  documented (needs maintainer credentials, not executed here).

Milestone 6.3 Accessibility and localisation

- Accessibility pass over popup and dashboard (landmarks, focus order, live regions,
  contrast, reduced motion).
- UI chrome in Norwegian bokmål behind a language setting (tabs, headings, settings, popup,
  buttons). Rule text (summaries, significance, actions) remains English in this phase.

Milestone 6.4 Community and carried-forward checks

- Rule proposal template, indicator review process, issue templates.
- Suricata `-T` / Zeek check if a tool is available; otherwise documented as unverified.

Gate 6: a tagged build reproduces byte-for-byte from a clean checkout (met: `v0.2.0` built in
GitHub Actions matches the local `SHA256SUMS` for every artifact, and the release is published
at https://github.com/reglund/AdTripwire/releases/tag/v0.2.0); a signed bundle verifies in both browsers
(met via the DEV self-test; the import UI itself was not click-tested); keyboard-only
walkthrough reviewed from markup, not performed by a person. Report: `docs/phase-6-report.md`.

## Cross-cutting (folded into Phase 6)

- Accessibility and localisation of the UI (Norwegian first after English).
- Release engineering: signed AMO listing, reproducible builds, SBOM, release notes.
- Community: contribution guide, rule proposal template, indicator review process.
