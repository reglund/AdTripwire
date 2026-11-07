import type { HandoffCoverLanguages, HandoffPreview } from "@adtripwire/shared";
import { HANDOFF_NOTE_MAX_LENGTH } from "@adtripwire/shared";
import { EXPORT_DISCLAIMER } from "@adtripwire/privacy";
import {
  CANNOT_CONCLUDE_EN,
  CANNOT_CONCLUDE_NB,
  CAN_CONCLUDE_EN,
  CAN_CONCLUDE_NB,
  EXPORT_DISCLAIMER_NB,
  PROFILE_EXPLANATION_EN,
  PROFILE_EXPLANATION_NB,
} from "../handoff-text.js";

export interface CoverNoteInput {
  profile: "default" | "strict";
  languages: HandoffCoverLanguages;
  counts: HandoffPreview;
  generatedAt: Date;
  /** Raw user text; normalised here. Never persisted. */
  note?: string;
}

// C0/C1 controls except "\n", DEL, zero-width and bidi controls, BOM, object replacement.
const STRIPPED =
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFC]/g;

/**
 * Turns the user's free text into inert plain text: control and bidirectional/zero-width
 * characters are dropped, line breaks are normalised, the length is capped, markup openers
 * are escaped, and every line is prefixed with "> " so that nothing in it can form a heading,
 * list or other structure of the cover note. Returns "" when nothing is left.
 */
export function quoteUserNote(raw: string): string {
  const normalised = raw
    .replace(/\r\n?|\u2028|\u2029|\u0085/g, "\n")
    .replace(/\t/g, " ")
    .replace(STRIPPED, "");
  const capped = Array.from(normalised).slice(0, HANDOFF_NOTE_MAX_LENGTH).join("");
  const lines = capped
    .split("\n")
    .map((l) => l.replace(/\s+$/, "").replace(/&/g, "&amp;").replace(/</g, "&lt;"));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => (l === "" ? ">" : `> ${l}`)).join("\n");
}

const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

interface Wording {
  title: string;
  generated: string;
  period: string;
  noPeriod: string;
  to: string;
  profile: string;
  explanation: string;
  included: string;
  counts: (c: HandoffPreview) => string;
  omitted: string;
  can: string;
  cannot: string;
  canItems: readonly string[];
  cannotItems: readonly string[];
  noteHeading: string;
  noNote: string;
  disclaimerHeading: string;
  disclaimer: string;
}

const EN = (profile: "default" | "strict"): Wording => ({
  title: "# AdTripwire cover note",
  generated: "Generated",
  period: "Period covered by the detections",
  noPeriod: "no detections in this selection",
  to: "to",
  profile: "Redaction profile",
  explanation: PROFILE_EXPLANATION_EN[profile],
  included: "Included in this package",
  counts: (c) =>
    `${c.detections} detection(s), ${c.events} supporting event(s), ${c.seenAlongsideRows} Seen-alongside row(s)`,
  omitted: "Seen-alongside hostnames are omitted by the strict profile.",
  can: "## What the recipient can conclude",
  cannot: "## What the recipient cannot conclude",
  canItems: CAN_CONCLUDE_EN,
  cannotItems: CANNOT_CONCLUDE_EN,
  noteHeading: "## Note from the sender (plain text, quoted)",
  noNote: "No note was added.",
  disclaimerHeading: "## Disclaimer",
  disclaimer: EXPORT_DISCLAIMER,
});

const NB = (profile: "default" | "strict"): Wording => ({
  title: "# AdTripwire følgenotat (norsk)",
  generated: "Opprettet",
  period: "Tidsrom dekket av deteksjonene",
  noPeriod: "ingen deteksjoner i dette utvalget",
  to: "til",
  profile: "Redigeringsprofil",
  explanation: PROFILE_EXPLANATION_NB[profile],
  included: "Med i denne pakken",
  counts: (c) =>
    `${c.detections} deteksjon(er), ${c.events} støttende hendelse(r), ${c.seenAlongsideRows} rad(er) under Sett sammen med`,
  omitted: "Vertsnavnene under Sett sammen med er utelatt av den strenge profilen.",
  can: "## Hva mottakeren kan slutte",
  cannot: "## Hva mottakeren ikke kan slutte",
  canItems: CAN_CONCLUDE_NB,
  cannotItems: CANNOT_CONCLUDE_NB,
  noteHeading: "## Notat fra avsender (bare tekst, sitert)",
  noNote: "Ingen notat ble lagt ved.",
  disclaimerHeading: "## Forbehold",
  disclaimer: EXPORT_DISCLAIMER_NB,
});

function section(w: Wording, input: CoverNoteInput, quoted: string): string {
  const { counts, profile } = input;
  const period =
    counts.firstTimestamp !== undefined && counts.lastTimestamp !== undefined
      ? `${day(counts.firstTimestamp)} ${w.to} ${day(counts.lastTimestamp)} (UTC)`
      : w.noPeriod;
  return [
    w.title,
    "",
    `- ${w.generated}: ${input.generatedAt.toISOString()}`,
    `- ${w.period}: ${period}`,
    `- ${w.profile}: ${profile}. ${w.explanation}`,
    `- ${w.included}: ${w.counts(counts)}${counts.seenAlongsideOmitted ? `. ${w.omitted}` : ""}`,
    "",
    w.can,
    "",
    ...w.canItems.map((i) => `- ${i}`),
    "",
    w.cannot,
    "",
    ...w.cannotItems.map((i) => `- ${i}`),
    "",
    w.noteHeading,
    "",
    quoted === "" ? w.noNote : quoted,
    "",
    w.disclaimerHeading,
    "",
    w.disclaimer,
    "",
  ].join("\n");
}

/** Markdown cover note for the hand-off package. English always; Norwegian when chosen. */
export function buildCoverNote(input: CoverNoteInput): string {
  const quoted = quoteUserNote(input.note ?? "");
  const parts = [section(EN(input.profile), input, quoted)];
  if (input.languages === "en+nb") {
    parts.push(section(NB(input.profile), input, quoted));
  }
  return parts.join("\n---\n\n");
}
