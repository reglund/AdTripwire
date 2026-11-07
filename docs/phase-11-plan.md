# Phase 11 — Ask the evidence, in Norwegian — plan

Status: **implemented 2026-11-07, unreleased.** Plan by Claude Opus 5.5; built by sonnet-builder
(rules in two halves, UI, share sheet); Part C guardrails by the main session; opus-reviewer:
fix-then-ship, findings fixed; native-reader terminology review by the user applied. Evidence
lines (`evidence[].observed`) and cluster/timeline prose stay English.
Roadmap entry: `docs/roadmap.md`, Phase 11.

## Starting point (measured)

- The UI chrome is already bilingual: `t()` with `i18n.nb.ts`, language from settings or the
  browser (`resolveLanguage`).
- **Detection text is English only.** Each of the 27 rule files in
  `packages/detection-engine/src/rules/` builds `summary`, `significance`, `confidenceRationale`,
  `alternativeExplanations`, `recommendedActions`, `limitations` and `missingVisibility` as
  template literals with hostnames and counts interpolated (≈150 text sites, ~15 k words of
  source in total, much of it code). The text is stored with the detection, so the UI cannot
  translate it after the fact without fragile string matching.
- **Rule definitions** (`RuleDefinition`: `name`, `description`, `confidenceBasis`,
  `limitations`, `falsePositiveConsiderations`) are English only; the Rules view shows them.
- The assist build already has Norwegian prompts (`SYSTEM_PROMPT_NB`) and Norwegian hedges in
  the verdict screen (`guardrails.ts`). That part of the roadmap entry is largely done; this
  phase only verifies it with the red-team cases.
- The hand-off package exists (`export_handoff`, `research-export.ts`) with a readme, a
  redaction profile (`default` | `strict`) and, since 0.4.0, the Seen-alongside section.

## Design decisions

**D1 — Rules produce both languages at detection time.** A small helper in
`detection-engine` (`text(en, nb)` / `texts([...])`) lets each rule write the Norwegian next to
the English, with the same interpolated values. `Detection` gains an optional
`nb?: DetectionTextNb` holding the same seven text fields. Stored English stays authoritative
and unchanged (exports, STIX, SIEM and dedup keys keep using it). Old stored detections have no
`nb` and are shown in English with a one-line note.

Rejected: render-time translation by matching English sentences (breaks on every wording
change, and interpolation makes it regex soup); message-id catalogues (a 27-file refactor of
how text is built, for no user-visible gain over D1).

**D2 — Rule definitions get `nb?: RuleDefinitionNb`** (name, description, confidenceBasis,
limitations, falsePositiveConsiderations). The Rules view picks it when the UI language is nb.

**D3 — Wording rules apply to Norwegian too.** Extend the verdict-word guard (the existing
English check for "infected", "spied", "safe", "clean"…) with a Norwegian list: _infisert,
smittet, kompromittert, spionert, overvåket deg, trygg, sikker (as a verdict), ren, uten fare,
hacket_. Conservative phrasing: _observert trafikk_, _dokumentert infrastruktur_, _kan tyde
på_, _sier ikke noe om_.

**D4 — Exports stay English, with one exception.** Researchers and helplines work in English;
the package carries English evidence. The new cover note (below) is written in the UI
language the user chooses, with the English version always included.

## What ships

### Part A — Norwegian detection and rule text

1. `packages/shared`: `DetectionTextNb`, `RuleDefinitionNb`, optional fields on `Detection`
   and `RuleDefinition`; `validateDetection`-style guards accept and bound them.
2. `detection-engine`: helper; every rule fills `nb` (all text fields, same interpolations).
3. UI: detection detail, timeline cards, digest/morning line and Rules view use `nb` when the
   language is nb and the field exists; otherwise English plus "(English: stored before
   Norwegian text existed)".
4. Tests:
   - every rule's positive test asserts `nb` is present and every English text field has a
     Norwegian counterpart (same array lengths);
   - Norwegian verdict-word guard over all rule output and definitions (negative test with a
     planted word);
   - interpolated hostnames appear identically in both languages;
   - storage round-trip with and without `nb`.

### Part B — "Share with a specialist"

1. Dashboard action on a detection, a cluster or "everything": opens a sheet, before any file is
   produced, that shows
   - the redaction profile that will be used (default / strict) with what each removes, and
     lets the user switch;
   - what will be included (counts: detections, events, Seen-alongside rows);
   - a recipient checklist, _"What the recipient can conclude"_ / _"cannot conclude"_
     (e.g. can: which documented hosts were contacted, when, from which kind of frame; cannot:
     whether the device is compromised, who targeted you, whether the ad was meant for you);
   - an optional free-text note from the user (bounded length, plain text, stored nowhere,
     included only in this export);
   - where to send it: Access Now Digital Security Helpline, your organisation's CERT/IT
     security, Citizen Lab — as text with links that open in a new tab. No network from the
     extension, no mailto attachments.
2. The hand-off package gains `cover-note.md` (en, plus nb when chosen): date range, profile,
   counts, the checklist, the user's note, and the standard disclaimer.
3. Tests: cover note contains the checklist and disclaimer in both languages; the note is
   length-bounded and treated as text; strict profile still strict; the package's STIX file
   validates unchanged after the cover note is added (Gate 11).

### Part C — Assist (verification only)

Run the existing assist red-team cases in nb (`pnpm eval:assist -- --languages nb` against a
local model, plus the unit red-team cases in `guardrails`), and add cases for the new
Norwegian verdict words from D3 to the screen. No new model features.

## Gate 11

- All rules emit complete Norwegian text; the Norwegian verdict-word guard passes; Rules view
  and detection detail render in nb.
- **A native reader (the user) reviews** the Norwegian rule text, from a generated review
  document (`docs/phase-11-nb-review.md`: every rule, English and Norwegian side by side,
  rendered from a synthetic run so interpolations are visible).
- The hand-off package with cover note validates (STIX validator test) and strict stays strict.
- Assist nb red-team cases pass.
- opus-reviewer on the full diff (wording, privacy of the free-text note, export integrity).

## Work split

1. Shared types + helper + 13 rules (sonnet-builder), 2. remaining 14 rules (sonnet-builder),
   in parallel after the types land; 3. UI language switch for detection/rule text and the
   review document generator (sonnet-builder); 4. Share sheet + cover note (sonnet-builder); 5. Part C and the guard (main session); 6. review (opus-reviewer); 7. native-reader review
   (the user).

Release as 0.5.0 after the native-reader review.

## Out of scope

Nynorsk; translating exports; any network or mail integration; new assist features.
