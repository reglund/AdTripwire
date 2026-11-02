import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import {
  approxRegistrableDomain,
  buildDetection,
  isFirstObservation,
  lowerSeverity,
  relatedEvents,
} from "./common.js";
import {
  CORRELATION_LIMITATIONS,
  ancestryMissing,
  lineageRelation,
  linkEvidence,
  scopeEvidence,
  scopeLimitations,
  type ChainScope,
} from "./correlation-common.js";
import { isNoasContact } from "./noas.js";

const FRAME_PARAMS = ["impid", "qq"];

export const definition: RuleDefinition = {
  id: "correlation.noas_then_hidden_frame",
  name: "Ad-selection request followed by a loader-style frame",
  version: "1.1.0",
  description:
    "After a NOAS/getAd-pattern request in the same frame lineage (same tab only: one level lower), an iframe loaded a different third-party host with 'impid' or 'qq' parameters, matching the documented '/iframe?impid=' and '/?qq=' loader frames.",
  category: "temporal_correlation",
  severity: "elevated",
  confidence: "medium",
  confidenceBasis:
    "Medium: both events are observed and the parameter names match the documented loader frames; the link between them is inferred from tab and timing.",
  requiredEvidence: [
    "A NOAS/getAd-pattern request or NOAS indicator contact in the same frame lineage within the correlation window (same tab only: one severity level lower).",
    "A later sub_frame request to a different third-party host whose query parameter names include 'impid' or 'qq'.",
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: [
    ...CORRELATION_LIMITATIONS,
    "Frame dimensions are not observable from network metadata, so 'hidden' is inferred from the documented pattern.",
  ],
  falsePositiveConsiderations: [
    "'impid' (impression id) is a common ad-tech parameter name used by many ordinary ad frames.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (
    event.resourceType !== "sub_frame" ||
    !isFirstObservation(event, ctx) ||
    event.eventType === "request_error"
  )
    return [];
  const names = event.destination.queryParamNames;
  const hit = FRAME_PARAMS.filter((p) => names.includes(p));
  if (hit.length === 0) return [];
  const host = event.destination.hostname;
  const top = event.frameContext.topHostname;
  const thirdParty =
    event.frameContext.thirdParty === true ||
    (top !== undefined && approxRegistrableDomain(top) !== approxRegistrableDomain(host));
  if (!thirdParty) return [];
  const prior = relatedEvents(event, ctx).reverse();
  const isS1 = (e: NormalizedEvent): boolean =>
    e.destination.hostname !== host && isNoasContact(e, ctx);
  let scope: ChainScope = "lineage";
  let s1 = prior.find((e) => isS1(e) && lineageRelation(e, event) === "related");
  if (!s1) {
    scope = "tab";
    s1 = prior.find(isS1);
  }
  if (!s1) return [];
  const ancestryUnavailable = scope === "tab" && ancestryMissing([s1, event]);
  return [
    buildDetection(definition, ctx, {
      subject: `${event.tabId ?? event.correlationId ?? ""}|${host}`,
      severity: scope === "lineage" ? definition.severity : lowerSeverity(definition.severity),
      confidenceRationale:
        scope === "lineage"
          ? "Both requests were observed directly, in the same frame lineage, and the frame's parameter names match the documented loader; the relationship is inferred from lineage and timing."
          : "Both requests were observed directly and the frame's parameter names match the documented loader, but they are linked only by tab and timing, not frame lineage, so the priority is lowered one level.",
      summary:
        "An ad-selection request was followed in the same tab by a frame load with parameters resembling the documented loader frames.",
      significance:
        "In the documented chain, selected devices received code that injected a 1x1 frame with 'impid' or 'qq' parameters to load the next stage.",
      evidence: [
        {
          eventIds: [s1.eventId],
          observed: `Ad-selection request to ${s1.destination.hostname}.`,
          kind: "observed",
        },
        {
          eventIds: [event.eventId],
          observed: `Sub-frame request to ${host} with parameter name(s): ${hit.join(", ")}.`,
          kind: "observed",
        },
        linkEvidence(s1, event, "Link from ad-selection request to frame", scope),
        scopeEvidence(scope, ancestryUnavailable, [s1, event]),
      ],
      extraLimitations: scopeLimitations(scope, ancestryUnavailable),
      events: [s1, event],
      matchedIndicatorIds: [...ctx.indicatorMatches(s1), ...ctx.indicatorMatches(event)].map(
        (m) => m.indicator.id,
      ),
      subjectHostnames: [s1.destination.hostname, host],
      alternativeExplanations: [
        "An ordinary ad frame using an impression-id parameter.",
        "Unrelated frames loaded by the same ad-heavy page.",
      ],
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
