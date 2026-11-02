import type { IndicatorMatch, NormalizedEvent } from "@adtripwire/shared";
import type { RuleContext } from "./types.js";
import { isFirstObservation } from "./common.js";

export const EXPIRED_LIMITATION =
  "Indicator past its documented validity window; the host may have been reassigned.";

/** True when there is at least one match and every match is past its validity window. */
export function allExpired(matches: readonly IndicatorMatch[]): boolean {
  return matches.length > 0 && matches.every((m) => m.validity === "expired");
}

export const INFRA_LIMITATIONS = [
  "Indicator lists reflect what researchers published at a point in time; infrastructure changes hands and may be reused or retired.",
  "A hostname match says nothing about what was delivered, or whether anything executed.",
];

export const INFRA_FALSE_POSITIVES = [
  "Ad infrastructure is shown to very large numbers of people; most contact is incidental exposure.",
  "Security researchers, sandboxes and link scanners routinely contact documented infrastructure.",
  "Domains may have been re-registered by unrelated parties after publication.",
];

/** Indicator matches for an event that is the first sighting of its request. */
export function contactMatches(event: NormalizedEvent, ctx: RuleContext): IndicatorMatch[] {
  if (!isFirstObservation(event, ctx)) return [];
  if (event.eventType === "request_error" || event.eventType === "request_redirected") return [];
  return ctx.indicatorMatches(event);
}

export function describeMatch(m: IndicatorMatch): string {
  const kind =
    m.matchKind === "exact_hostname"
      ? "exact hostname"
      : m.matchKind === "domain_suffix"
        ? "subdomain of a documented domain"
        : m.matchKind === "hostname_path"
          ? "documented hostname and path"
          : "documented path";
  const validity =
    m.validity === "expired"
      ? " The indicator is past its documented validity window."
      : m.validity === "not_yet_valid"
        ? " The indicator's documented validity window has not started yet."
        : "";
  return `Destination matched indicator ${m.indicator.id} (${m.indicator.classification}${m.indicator.role ? `, role ${m.indicator.role}` : ""}; ${kind}) from ${m.indicator.source}.${validity}`;
}

export function indicatorReferences(
  matches: IndicatorMatch[],
  base: Array<{ title: string; url: string }>,
): Array<{ title: string; url: string }> {
  const out = [...base];
  for (const m of matches) {
    if (!out.some((r) => r.url === m.indicator.sourceUrl))
      out.push({ title: m.indicator.source, url: m.indicator.sourceUrl });
  }
  return out;
}
