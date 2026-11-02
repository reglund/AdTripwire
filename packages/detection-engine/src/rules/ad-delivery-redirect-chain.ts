import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import {
  RULE_VERSION,
  approxRegistrableDomain,
  buildDetection,
  hasThirdPartyFlag,
} from "./common.js";

export const definition: RuleDefinition = {
  id: "ad_delivery.redirect_chain",
  name: "Multi-hop redirect chain from an ad-classified context",
  version: RULE_VERSION,
  description:
    "A request was redirected three or more times across at least two registrable domains, starting from a request Firefox classified as advertising or tracking. Reported once per tab per correlation window with an occurrence count; informational unless a hop reaches documented infrastructure.",
  category: "ad_delivery_behaviour",
  severity: "informational",
  confidence: "low",
  confidenceBasis:
    "Always low: redirect chains are routine in ad delivery (cookie syncing, click tracking); with consent a single page can produce dozens. Raised to suspicious only when a hop reaches a host in the indicator set.",
  requiredEvidence: [
    "Three or more request_redirected events sharing a request id inside the correlation window.",
    "The first observed hop classified as tracking_ad or tracking (third-party).",
    "At least two distinct registrable domains across the hops.",
    "Suspicious only: at least one hop's host matches an indicator.",
  ],
  requiredCapabilities: ["request_metadata", "redirect_chain", "url_classification"],
  references: BOTH,
  limitations: [
    "Registrable domains are approximated without a full public-suffix list.",
    "Only redirects of a single request id are linked; client-side navigations are not.",
  ],
  falsePositiveConsiderations: [
    "Cookie-sync and click-tracking chains routinely cross several ad-tech domains; an exposure evaluation with consent (2026-11-02) saw 30-60 such chains per ad-heavy page, which is why the rule aggregates per tab and stays informational by default.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (event.eventType !== "request_redirected" || event.requestId === undefined) return [];
  const cutoff = event.timestamp - ctx.settings.correlationWindowMs;
  const prior = ctx.window
    .byRequestId(event.requestId)
    .filter((e) => e.timestamp >= cutoff && e.eventId !== event.eventId);
  const hops = [...prior.filter((e) => e.eventType === "request_redirected"), event];
  if (hops.length < 3) return [];
  const first = prior[0] ?? event;
  if (!hasThirdPartyFlag(first, "tracking_ad", "tracking")) return [];
  const hosts = new Set<string>();
  for (const h of hops) {
    hosts.add(h.destination.hostname);
    if (h.redirectHostname) hosts.add(h.redirectHostname);
  }
  const domains = new Set([...hosts].map(approxRegistrableDomain));
  if (domains.size < 2) return [];
  const indicatorHosts = [...hosts].filter((h) => ctx.matcher.match(h, "/", ctx.now).length > 0);
  const severity = indicatorHosts.length > 0 ? "suspicious" : "informational";
  return [
    buildDetection(definition, ctx, {
      // One detection per tab per correlation window; further chains raise occurrenceCount and
      // a chain reaching documented infrastructure escalates the stored detection in place.
      subject: `tab:${event.tabId ?? "unknown"}`,
      severity,
      confidenceRationale:
        indicatorHosts.length > 0
          ? "A redirect hop reached a host in the indicator set; the chain itself is still routine ad-tech behaviour, so confidence stays low."
          : "Multi-hop redirects from ad contexts are common in ordinary advertising; this is context, not evidence.",
      summary:
        indicatorHosts.length > 0
          ? `An ad redirect chain in this tab reached documented infrastructure (${indicatorHosts.join(", ")}).`
          : `Ad redirect chains observed in this tab (first seen: ${hops.length} hops across ${domains.size} domains); further chains are counted as occurrences.`,
      significance:
        "Documented delivery chains pass through several ad-tech hops; long chains add context to other signals but are routine on their own.",
      evidence: [
        {
          eventIds: hops.map((h) => h.eventId),
          observed: `${hops.length} redirects observed for one request across ${domains.size} registrable domains.`,
          kind: "observed",
        },
        {
          eventIds: [first.eventId],
          observed: "The first observed hop was classified by Firefox as advertising/tracking.",
          kind: "observed",
        },
      ],
      events: [first, ...hops],
      subjectHostnames: [...hosts],
      alternativeExplanations: [
        "Cookie synchronisation between ad exchanges.",
        "Click or impression tracking redirects.",
      ],
      recommendedActions: [
        "Treat as context; review alongside any other detections in the same tab.",
      ],
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
