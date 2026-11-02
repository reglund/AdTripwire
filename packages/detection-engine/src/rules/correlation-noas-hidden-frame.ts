import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import {
  RULE_VERSION,
  approxRegistrableDomain,
  buildDetection,
  isFirstObservation,
  relatedEvents,
} from "./common.js";
import { CORRELATION_LIMITATIONS, linkEvidence } from "./correlation-common.js";
import { isNoasContact } from "./noas.js";

const FRAME_PARAMS = ["impid", "qq"];

export const definition: RuleDefinition = {
  id: "correlation.noas_then_hidden_frame",
  name: "Ad-selection request followed by a loader-style frame",
  version: RULE_VERSION,
  description:
    "After a NOAS/getAd-pattern request in the same tab, an iframe loaded a different third-party host with 'impid' or 'qq' parameters, matching the documented '/iframe?impid=' and '/?qq=' loader frames.",
  category: "temporal_correlation",
  severity: "elevated",
  confidence: "medium",
  confidenceBasis:
    "Medium: both events are observed and the parameter names match the documented loader frames; the link between them is inferred from tab and timing.",
  requiredEvidence: [
    "A NOAS/getAd-pattern request or NOAS indicator contact in the same tab within the correlation window.",
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
  const s1 = relatedEvents(event, ctx)
    .reverse()
    .find((e) => e.destination.hostname !== host && isNoasContact(e, ctx));
  if (!s1) return [];
  return [
    buildDetection(definition, ctx, {
      subject: `${event.tabId ?? event.correlationId ?? ""}|${host}`,
      confidenceRationale:
        "Both requests were observed directly and the frame's parameter names match the documented loader; the relationship is inferred from shared tab and timing.",
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
        linkEvidence(s1, event, "Link from ad-selection request to frame"),
      ],
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
