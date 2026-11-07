import { describe, expect, it } from "vitest";
import { assertConservativeNb } from "../../detection-engine/src/__test__/fixtures.js";
import {
  CANNOT_CONCLUDE_NB,
  CAN_CONCLUDE_NB,
  EXPORT_DISCLAIMER_NB,
  PROFILE_EXPLANATION_NB,
} from "./handoff-text.js";
import { NB } from "./ui/i18n.nb.js";

/**
 * Narrow, explicit exceptions. "kompromittert" is allowed only in the negated "cannot conclude"
 * checklist item (what the recipient cannot conclude), never as a claim anywhere else.
 */
const ALLOWED: ReadonlySet<string> = new Set<string>([
  "Om enheten er kompromittert, eller er fri for spionvare.",
  // Existing UI string; negated ("not a probability of compromise").
  "Alvorlighet er en prioritet for undersøkelse, ikke en sannsynlighet for kompromittering.",
  // Existing assist-panel strings that describe what the screen removes or keeps; not claims.
  "Svaret er en tolkning: det kontrolleres for påstander om infeksjon eller trygghet og for vertsnavn som ikke finnes i beviset, merkes, og lagres eller eksporteres aldri.",
  "Modellen påsto at enheten eller personen er kompromittert; den setningen ble fjernet.",
  "Modellen påsto at enheten eller personen ikke er berørt; den setningen ble fjernet.",
  "En setning nevner smitte eller sikkerhet bare som noe beviset ikke kan vise; den ble beholdt.",
  "Kompromittering som ikke gir de observerbare indikatorene dette verktøyet leter etter, inkludert utnyttelse som ikke setter spor som er synlige i nettleseren.",
]);

// "ren tekst" is the Norwegian idiom for "plain text"; the guard's "ren" (clean) would trip on it.
const PLAIN_TEXT_IDIOM = /(?<!\p{L})ren tekst(?!\p{L})/giu;

const check = (label: string, text: string): void => {
  if (ALLOWED.has(text)) return;
  assertConservativeNb(label, text.replace(PLAIN_TEXT_IDIOM, "tekst"));
};

describe("Norwegian verdict-word guard over the share sheet and cover note", () => {
  it("passes for the hand-off wording", () => {
    const texts = [
      ...CAN_CONCLUDE_NB,
      ...CANNOT_CONCLUDE_NB,
      ...Object.values(PROFILE_EXPLANATION_NB),
      EXPORT_DISCLAIMER_NB,
    ];
    for (const [i, text] of texts.entries())
      expect(() => check(`handoff-text #${i}`, text)).not.toThrow();
  });

  it("passes for every value of the UI dictionary", () => {
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(NB)) {
      try {
        check(`NB[${key}]`, value);
      } catch {
        offenders.push(value);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("allows kompromittert only in the exact negated checklist string", () => {
    expect(ALLOWED.size).toBe(7);
    expect(CANNOT_CONCLUDE_NB).toContain([...ALLOWED][0]);
    expect(() => check("claim", "Enheten er kompromittert.")).toThrow();
    expect(() =>
      check("claim", "Om enheten er kompromittert, eller er fri for spionvare. Ja."),
    ).toThrow();
  });

  it("the guard itself trips on the widened words", () => {
    for (const w of [
      "Enheten er angrepet.",
      "Du er rammet.",
      "Du er berørt.",
      "Det er ufarlig.",
      "Det er harmløst nok: harmløs.",
      "Den er uskadelig.",
      "Du var overvåket.",
      "Ingen grunn til bekymring.",
    ])
      expect(() => assertConservativeNb("t", w), w).toThrow();
  });
});
