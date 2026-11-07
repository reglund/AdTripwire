/**
 * Fixed wording for the "Share with a specialist" sheet and the hand-off cover note. The
 * English strings are the keys of the UI translation table (i18n.nb.ts), and the Norwegian
 * strings here must equal those entries; a test enforces it, so the sheet and the cover note
 * cannot drift apart. Conservative wording only: observed traffic and documented
 * infrastructure, never a verdict about a device.
 */

export const CAN_CONCLUDE_EN: readonly string[] = [
  "Which documented hosts the browser contacted, and when.",
  "From which kind of frame the contact came (the page itself or an embedded ad frame).",
  "Which rules fired and why, with the evidence each rule used.",
];

export const CANNOT_CONCLUDE_EN: readonly string[] = [
  "Whether the device has been compromised, or is free of spyware.",
  "Who targeted you, or whether an ad was meant for you.",
  "Anything about traffic the browser could not see (other apps, other browsers, other devices).",
];

export const CAN_CONCLUDE_NB: readonly string[] = [
  "Hvilke dokumenterte verter nettleseren kontaktet, og når.",
  "Hva slags ramme kontakten kom fra (selve siden eller en innebygd annonseramme).",
  "Hvilke regler som utløstes og hvorfor, med bevisene hver regel brukte.",
];

export const CANNOT_CONCLUDE_NB: readonly string[] = [
  "Om enheten er kompromittert, eller er fri for spionvare.",
  "Hvem som var målet, eller om en annonse var ment for deg.",
  "Noe om trafikk nettleseren ikke kunne se (andre apper, andre nettlesere, andre enheter).",
];

export const PROFILE_EXPLANATION_EN = {
  default:
    "Default: hostnames are shown as observed. Cookie values, full URLs, query values and page content are never included.",
  strict:
    "Strict: hostnames that are not central to a detection are replaced by pseudonyms, paths are reduced to placeholders, and your analyst notes and the Seen-alongside hostnames are left out. The optional note you type is included as written.",
} as const;

export const PROFILE_EXPLANATION_NB = {
  default:
    "Standard: vertsnavn vises slik de ble observert. Informasjonskapselverdier, fullstendige nettadresser, spørringsverdier og sideinnhold tas aldri med.",
  strict:
    "Streng: vertsnavn som ikke er sentrale for en deteksjon erstattes av pseudonymer, stier reduseres til plassholdere, og dine analytikernotater og vertsnavnene under Sett sammen med er utelatt. Notatet du eventuelt skriver, tas med slik du har skrevet det.",
} as const;

/** Norwegian rendering of EXPORT_DISCLAIMER (@adtripwire/privacy) for the cover note. */
export const EXPORT_DISCLAIMER_NB =
  "AdTripwire registrerer bare observerbare indikatorer. Fravær av deteksjoner er ikke bevis for at en enhet er fri for spionvare. Treff på infrastruktur beskriver eksponering for dokumentert infrastruktur, ikke et bekreftet innbrudd i en enhet.";
