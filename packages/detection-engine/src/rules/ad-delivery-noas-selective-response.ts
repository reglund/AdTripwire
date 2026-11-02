import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { RULE_VERSION, buildDetection, isJsContentType, responseBytes } from "./common.js";
import { isNoasPattern } from "./noas.js";
import { jsGrade } from "./js-common.js";

export const definition: RuleDefinition = {
  id: "ad_delivery.noas_selective_response",
  name: "Response from a NOAS/getAd-pattern request",
  version: RULE_VERSION,
  description:
    "Classifies the response to a NOAS/getAd-pattern request. An empty response is the documented outcome for non-selected devices; a non-empty JavaScript response is the documented branch for selected devices.",
  category: "ad_delivery_behaviour",
  severity: "elevated",
  confidence: "medium",
  confidenceBasis:
    "Medium for a non-empty JavaScript response, because selection servers documented by Citizen Lab and Confiant return code only to selected devices; but unrelated ad servers also return JavaScript from similar endpoints.",
  requiredEvidence: [
    "A request_completed or response_inspected event for a NOAS/getAd-pattern request.",
    "An observed response size (Content-Length or inspected byte count).",
  ],
  requiredCapabilities: ["request_metadata"],
  references: BOTH,
  limitations: [
    "Requires response size or response body visibility; chunked responses without Content-Length cannot be sized from headers alone.",
    "Cached responses do not reflect a fresh server decision.",
  ],
  falsePositiveConsiderations: [
    "A zero-byte response is the common, expected outcome and is not suspicious.",
    "A JavaScript response from an ad endpoint is not malicious by itself.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (event.eventType !== "request_completed" && event.eventType !== "response_inspected")
    return [];
  if (!isNoasPattern(event)) return [];
  const bytes = responseBytes(event);
  if (bytes === undefined) return [];
  const host = event.destination.hostname;
  const base = {
    events: [event],
    subjectHostnames: [host],
    matchedIndicatorIds: ctx.indicatorMatches(event).map((m) => m.indicator.id),
  };
  if (bytes === 0) {
    return [
      buildDetection(definition, ctx, {
        ...base,
        subject: `${host}|empty`,
        severity: "informational",
        confidence: "medium",
        confidenceRationale:
          "The empty response was directly observed; per the cited research this is the typical outcome for devices that were not selected.",
        summary:
          "Empty response: typical of non-selected devices; indicates exposure to selection infrastructure, not selection.",
        significance:
          "Most devices receive an empty response from documented selection servers. This records exposure only.",
        evidence: [
          {
            eventIds: [event.eventId],
            observed: "The NOAS/getAd-pattern request returned an empty (0-byte) response.",
            kind: "observed",
          },
        ],
        alternativeExplanations: [
          "Ad servers routinely return empty responses when they have no ad to fill.",
        ],
        recommendedActions: ["No action is needed for this event alone."],
      }),
    ];
  }
  const insp = event.responseInspection;
  const isJs =
    isJsContentType(insp?.contentType) || (insp !== undefined && insp.markers.length > 0);
  const subject = `${host}|${event.requestId ?? event.eventId}|nonempty`;
  if (insp !== undefined && isJs) {
    // Elevated only with corroboration: the host is a documented indicator, or the delivered
    // script carries a suspicious technique combination. A generic "/getAd" endpoint that
    // returns an ordinary ad script is suspicious at most.
    const hostDocumented = ctx.indicatorMatches(event).length > 0;
    const scriptGrade = jsGrade(insp.markers);
    const corroborated = hostDocumented || scriptGrade !== null;
    return [
      buildDetection(definition, ctx, {
        ...base,
        subject,
        severity: corroborated ? "elevated" : "suspicious",
        confidence: corroborated ? "medium" : "low",
        confidenceRationale: corroborated
          ? `A non-empty JavaScript response from a NOAS/getAd-pattern request matches the documented 'selected device' branch, corroborated by ${hostDocumented ? "a documented indicator host" : "suspicious technique markers in the delivered script"}.`
          : "A non-empty JavaScript response from a NOAS/getAd-pattern request matches the documented 'selected device' branch, but the host is not a documented indicator and the script shows no suspicious technique combination; unrelated ad software uses similar endpoint names.",
        summary: corroborated
          ? "A NOAS/getAd-pattern request returned non-empty JavaScript, the less common branch documented for selected devices."
          : "A getAd-pattern request from an undocumented host returned JavaScript; this resembles but does not confirm the documented selection pattern.",
        significance:
          "In the documented operation, only selected devices receive JavaScript from the selection server; that code then loads hidden frames or further scripts. This does not establish what the code did.",
        evidence: [
          {
            eventIds: [event.eventId],
            observed: `The response contained ${bytes} bytes${insp.contentType ? ` of ${insp.contentType}` : ""}${insp.markers.length > 0 ? ` with ${insp.markers.length} technique marker(s)` : ""}.`,
            kind: "observed",
          },
        ],
        alternativeExplanations: [
          "An unrelated ad server returned an ordinary ad-rendering script.",
          "A shared endpoint name coincides with the documented pattern.",
        ],
        recommendedActions: [
          "Review any JavaScript-technique and correlation detections in the same tab.",
          "Export the evidence if contact with malicious infrastructure followed.",
        ],
      }),
    ];
  }
  const scriptish = event.resourceType === "script" || event.resourceType === "xmlhttprequest";
  return [
    buildDetection(definition, ctx, {
      ...base,
      subject,
      severity: scriptish ? "suspicious" : "informational",
      confidence: "low",
      confidenceRationale:
        insp === undefined
          ? "The response size was observed but its content was not inspected, so it is unknown whether JavaScript was returned."
          : "The response was inspected and did not look like JavaScript.",
      summary:
        "A NOAS/getAd-pattern request returned a non-empty response; its content type was not confirmed as JavaScript.",
      significance:
        "Non-empty responses are the less common branch for documented selection servers, but content was not confirmed as code.",
      evidence: [
        {
          eventIds: [event.eventId],
          observed: `The response size was ${bytes} bytes.`,
          kind: "observed",
        },
      ],
      alternativeExplanations: [
        "The server returned an ordinary ad image, tracking pixel, or configuration data.",
      ],
      recommendedActions: [
        "Enable response inspection (Firefox) to distinguish code from other content.",
      ],
    }),
  ];
}

export const rule: Rule = {
  definition,
  anyOfCapabilities: ["response_size", "response_body_inspection"],
  evaluate,
};
