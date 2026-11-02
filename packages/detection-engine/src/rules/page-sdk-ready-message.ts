import type { Detection, NormalizedEvent, RuleDefinition } from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { buildDetection } from "./common.js";
import { PAGE_LIMITATIONS, isSubFrame, pageSignalOf, signalFrameHost } from "./page-common.js";

export const definition: RuleDefinition = {
  id: "page.sdk_ready_message",
  name: "Cross-window message carrying the documented SDK ready type",
  version: "1.0.0",
  description:
    "The opt-in page sensor observed a cross-window message whose type is 'analytics_sdk_ready', the string specific to the documented AdFection delivery SDK, in a sub-frame. A cross-origin object message with a generic 'type' field is recorded as informational context only.",
  category: "javascript_technique",
  severity: "elevated",
  confidence: "high",
  confidenceBasis:
    "High for the SDK ready type in a sub-frame: the string is specific to the documented SDK and the message was observed directly rather than inferred from script text. Medium in the top document (the documented SDK ran in ad frames); low for generic typed messages, which are ubiquitous.",
  requiredEvidence: [
    "page_signal event of kind postmessage_sdk_ready (sub-frame for elevated), or postmessage_wildcard_like (informational).",
  ],
  requiredCapabilities: ["page_signals"],
  references: BOTH,
  limitations: [
    ...PAGE_LIMITATIONS,
    "Only the message type is checked; the message origin, target and payload are not retained.",
  ],
  falsePositiveConsiderations: [
    "A page that discusses or replays the documented SDK could post the same message type.",
    "Typed cross-window messages ('type' fields) are used by most ad and embed frameworks.",
  ],
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  const p = pageSignalOf(event, "postmessage_sdk_ready", "postmessage_wildcard_like");
  if (!p) return [];
  const host = signalFrameHost(event);
  if (p.kind === "postmessage_wildcard_like") {
    return [
      buildDetection(definition, ctx, {
        subject: `${host}|wildcard_like`,
        severity: "informational",
        confidence: "low",
        confidenceRationale:
          "Typed cross-origin messages are used by most ad and embed frameworks; this is context for an analyst, not a finding.",
        summary: `A frame on ${host} received a cross-origin message with a typed object payload.`,
        significance:
          "The documented SDK announced itself with a typed cross-window message. Generic typed messages are very common and say nothing on their own.",
        evidence: [
          {
            eventIds: [event.eventId],
            observed: "The page sensor observed a cross-origin message carrying a 'type' field.",
            kind: "observed",
          },
        ],
        events: [event],
        subjectHostnames: [host],
        alternativeExplanations: [
          "Ordinary ad, video or social-embed frameworks exchanging resize or state messages.",
        ],
        recommendedActions: [
          "No action is needed unless other detections occurred in the same frame.",
        ],
      }),
    ];
  }
  const sub = isSubFrame(event);
  return [
    buildDetection(definition, ctx, {
      subject: `${host}|sdk_ready`,
      severity: sub ? "elevated" : "suspicious",
      confidence: sub ? "high" : "medium",
      confidenceRationale: sub
        ? "The message type is a string specific to the documented SDK and was observed directly in a sub-frame. That establishes the SDK message was sent, not what the SDK went on to do."
        : "The message type is specific to the documented SDK, but it was observed in the top-level document, whereas the documented SDK ran inside ad frames.",
      summary: `A frame on ${host} exchanged a cross-window message with the 'analytics_sdk_ready' type documented for the AdFection delivery SDK.`,
      significance:
        "In the documented chain the delivery SDK announced readiness with this message before loading further code. Observing it indicates the SDK, or something imitating it, ran in this frame; it does not show that anything further was delivered.",
      evidence: [
        {
          eventIds: [event.eventId],
          observed: `The page sensor observed a message of type 'analytics_sdk_ready' in ${sub ? "a sub-frame" : "the top-level document"} on ${host}.`,
          kind: "observed",
        },
      ],
      events: [event],
      subjectHostnames: [host],
      alternativeExplanations: [
        "A research or test page reproducing the documented SDK message.",
        "Another script that happens to reuse the same message type.",
      ],
      recommendedActions: [
        "Look for NOAS/getAd requests, inserted frames or contact with documented infrastructure in the same tab.",
        "Export the evidence bundle before clearing browser data.",
      ],
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
