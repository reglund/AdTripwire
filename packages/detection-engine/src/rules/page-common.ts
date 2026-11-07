import type { NormalizedEvent, PageSignal, PageSignalKind } from "@adtripwire/shared";
import type { RuleContext } from "./types.js";
import { relatedEvents } from "./common.js";
import { lineageRelation } from "./correlation-common.js";
import { isNoasContact } from "./noas.js";

export const PAGE_LIMITATIONS = [
  "Page signals come from an opt-in content script in sub-frames and report structural facts only (element kind, size class, target hostname); page text, cookie values and full URLs are never collected.",
  "A hostile page can suppress or imitate these DOM signals; absence of a signal is not evidence that nothing happened, and a signal alone does not show what the inserted element did.",
];

export const PAGE_LIMITATIONS_NB = [
  "Nettsidesignaler kommer fra et valgfritt innholdsskript i underrammer og rapporterer bare strukturelle fakta (elementtype, størrelsesklasse, målvert); sidetekst, informasjonskapselverdier og fullstendige URL-er samles aldri inn.",
  "En fiendtlig side kan undertrykke eller etterligne disse DOM-signalene; fravær av signal er ikke bevis for at ingenting skjedde, og et signal alene viser ikke hva det innsatte elementet gjorde.",
];

export const PAGE_FALSE_POSITIVES_NB = [
  "Annonsemateriell og målingsleverandører setter rutinemessig inn små eller usynlige rammer og tredjepartsskript etter innlasting (synlighetsmåling, verifisering, ID-synkronisering via informasjonskapsler).",
];

export const PAGE_FALSE_POSITIVES = [
  "Ad creatives and measurement vendors routinely insert small or invisible frames and third-party scripts after load (viewability, verification, cookie sync).",
];

/** The page signal of `e` when it is a page_signal event of one of `kinds`. */
export function pageSignalOf(
  e: NormalizedEvent,
  ...kinds: PageSignalKind[]
): PageSignal | undefined {
  if (e.eventType !== "page_signal" || !e.pageSignal) return undefined;
  return kinds.includes(e.pageSignal.kind) ? e.pageSignal : undefined;
}

/** Hostname of the frame that emitted the signal (document host when known). */
export function signalFrameHost(e: NormalizedEvent): string {
  return e.frameContext.documentHostname ?? e.destination.hostname;
}

export function isSubFrame(e: NormalizedEvent): boolean {
  return e.frameContext.frameId > 0 || e.frameContext.depth > 0;
}

/** Most recent NOAS contact in the same frame lineage within the correlation window. */
export function lineageNoasContact(
  e: NormalizedEvent,
  ctx: RuleContext,
): NormalizedEvent | undefined {
  const prior = relatedEvents(e, ctx);
  for (let i = prior.length - 1; i >= 0; i--) {
    const x = prior[i]!;
    if (lineageRelation(x, e) === "related" && isNoasContact(x, ctx)) return x;
  }
  return undefined;
}

export function timing(p: PageSignal): string {
  return p.msSinceLoad !== undefined
    ? ` ${Math.round(p.msSinceLoad)} ms after the frame loaded`
    : " after the frame loaded";
}
