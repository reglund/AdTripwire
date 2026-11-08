/**
 * "How each finding flowed": one chain per site and documented host, built from the observatory's
 * contacts and documented-host outcomes. Site -> issuing frame -> documented host (with its stage
 * in the AdFection chain) -> how the request ended -> how to read it.
 *
 * Reading texts are deliberately conservative: they describe exposure to documented
 * infrastructure and say when something is worth a closer look. They never say a device was
 * targeted, reached or left untouched.
 */
import { STAGES, documentedMatcher, loadIndicators, stageOf } from "./documented-hosts.mjs";
import { registrable } from "./registrable.mjs";

/** Most flow groups shown, newest first. */
export const FLOWS_MAX = 40;

const NAME_GONE = new Set(["net::ERR_NAME_NOT_RESOLVED", "NS_ERROR_UNKNOWN_HOST"]);

/**
 * Outcome class of one outcome row, most telling first:
 * content | answered | redirect | empty | http-error | failed | no-end | not-recorded.
 */
export function outcomeClass(o) {
  if (!o) return "not-recorded";
  const st = Object.keys(o.statuses ?? {});
  const ok = st.some((s) => /^2\d\d$/.test(s));
  if (ok && (o.maxBytes ?? 0) > 0) return "content";
  if (ok && o.maxBytes === undefined && !st.includes("204")) return "answered";
  if (st.some((s) => /^3/.test(s))) return "redirect";
  if (ok) return "empty";
  if (st.length) return "http-error";
  if (Object.keys(o.failures ?? {}).length) return "failed";
  return "no-end";
}

/** Short text for the outcome step. */
export function outcomeLabel(cls, o) {
  switch (cls) {
    case "content":
      return `Answered with content (up to ${o.maxBytes} bytes declared)`;
    case "answered":
      return "Answered (size not declared)";
    case "redirect":
      return o.redirectTo?.length
        ? `Redirected to ${o.redirectTo.join(", ")}`
        : "Redirected (target not recorded)";
    case "empty":
      return "Answered with an empty response";
    case "http-error":
      return `Answered with an HTTP error (${Object.keys(o.statuses).join(", ")})`;
    case "failed": {
      const codes = Object.keys(o.failures);
      return codes.every((c) => NAME_GONE.has(c))
        ? `Did not complete: the name no longer resolves (${codes.join(", ")})`
        : `Did not complete (${codes.join(", ")})`;
    }
    case "no-end":
      return "Requested; no end was recorded";
    default:
      return "Not recorded (measured from 2026-11-08)";
  }
}

/**
 * How to read a flow: stage first, then what the outcome adds. `attention` marks flows a
 * researcher or specialist should look at; it is a reading aid, not a verdict.
 */
export function reading(stage, cls) {
  const nothingBack = cls === "failed" || cls === "no-end";
  const answered = cls === "content" || cls === "answered";
  const tail = nothingBack ? " The request did not complete, so nothing came back." : "";
  switch (stage) {
    case "selection":
      if (answered)
        return {
          text: "An ad-selection server answered with content. Almost every device gets an empty answer, so this is worth a closer look by a researcher.",
          attention: true,
        };
      if (cls === "empty")
        return {
          text: "Empty answer from an ad-selection server, which is what almost every device receives. Exposure.",
          attention: false,
        };
      return { text: `Exposure to an ad-selection server.${tail}`, attention: false };
    case "delivery":
      if (cls === "not-recorded")
        return {
          text: "Contact with documented delivery or staging infrastructure. How the request ended was not recorded, so it cannot be read further.",
          attention: false,
        };
      return {
        text: `Contact with documented delivery or staging infrastructure.${tail || " Worth a closer look by a researcher."}`,
        attention: !nothingBack,
      };
    case "spyware":
      return {
        text: `Contact with documented spyware infrastructure. Worth a closer look by a specialist.${tail}`,
        attention: true,
      };
    default:
      return {
        text: `Exposure to tracking and ID sync. Common, and not by itself a sign of targeting.${tail}`,
        attention: false,
      };
  }
}

/** Frame step text from an outcome row's via/fromTop, relative to the site. */
export function frameLabel(site, o) {
  if (!o || (!o.via?.length && !o.fromTop)) return { title: "Frame not recorded", hosts: [] };
  const own = registrable(site);
  const ad = (o.via ?? []).filter((h) => registrable(h) !== own);
  const sameSite = (o.via ?? []).some((h) => registrable(h) === own);
  const parts = [];
  if (ad.length) parts.push("Ad frame");
  if (sameSite) parts.push("frame on the site's own domain");
  if (o.fromTop) parts.push("the page itself");
  const title = parts.join(" and ");
  return { title: title[0].toUpperCase() + title.slice(1), hosts: ad };
}

/**
 * Flow groups from index contacts and outcomes. One group per site, documented host, frame and
 * outcome class, with the dates, rigs and variants it was seen in. Newest first, at most
 * FLOWS_MAX. `indicators` defaults to the bundled set (for roles); documented hosts are matched
 * as of each date.
 */
export function buildFlows(contacts, outcomes, { indicators = loadIndicators() } = {}) {
  const byId = new Map(indicators.map((i) => [i.id, i]));
  const matchers = new Map();
  const matcherFor = (date) => {
    if (!matchers.has(date))
      matchers.set(
        date,
        documentedMatcher({ indicators, now: Date.parse(`${date}T12:00:00Z`) || Date.now() }),
      );
    return matchers.get(date);
  };
  // One record per (date, rig, variant, site, host); outcomes carry the richer facts.
  const seen = new Map();
  const key = (x) => [x.date, x.rig, x.variant, x.site, x.host].join("|");
  for (const o of outcomes) seen.set(key(o), { ...o, outcome: o });
  for (const c of contacts)
    for (const host of c.hostnames ?? []) {
      const indicator = matcherFor(c.date)(host);
      if (!indicator) continue;
      const rec = { date: c.date, rig: c.rig, variant: c.variant, site: c.site, host, indicator };
      const k = key(rec);
      const prev = seen.get(k);
      if (prev) prev.repeat = prev.repeat || c.repeat === true;
      else seen.set(k, { ...rec, repeat: c.repeat === true });
    }
  const groups = new Map();
  for (const r of seen.values()) {
    const ind = byId.get(r.indicator);
    const stage = stageOf(ind?.role, ind?.classification);
    const cls = outcomeClass(r.outcome);
    const frame = frameLabel(r.site, r.outcome);
    const gk = [r.site, r.host, frame.title, frame.hosts.join(","), cls].join("|");
    let g = groups.get(gk);
    if (!g) {
      g = {
        site: r.site,
        host: r.host,
        indicator: r.indicator,
        role: ind?.role ?? null,
        stage,
        frame,
        outcomeClass: cls,
        outcome: outcomeLabel(cls, r.outcome),
        reading: reading(stage, cls),
        dates: new Set(),
        rigs: new Set(),
        variants: new Set(),
        repeat: false,
        last: r.date,
      };
      groups.set(gk, g);
    }
    g.dates.add(r.date);
    g.rigs.add(r.rig);
    g.variants.add(r.variant);
    g.repeat = g.repeat || r.repeat === true;
    if (r.date > g.last) {
      g.last = r.date;
      g.outcome = outcomeLabel(cls, r.outcome); // newest wording (e.g. redirect target)
    }
  }
  return [...groups.values()]
    .sort((a, b) => (b.last > a.last ? 1 : b.last < a.last ? -1 : a.site.localeCompare(b.site)))
    .slice(0, FLOWS_MAX)
    .map(({ dates, rigs, variants, last: _last, ...g }) => ({
      ...g,
      dates: [...dates].sort(),
      rigs: [...rigs].sort(),
      variants: [...variants].sort(),
    }));
}

/** Count of flow groups per stage key (all five stages present). */
export function stageCounts(flows) {
  const n = Object.fromEntries(STAGES.map((s) => [s.key, 0]));
  for (const f of flows) n[f.stage] = (n[f.stage] ?? 0) + 1;
  return n;
}
