import type {
  Detection,
  NormalizedEvent,
  RuleDefinition,
  RuleDefinitionNb,
} from "@adtripwire/shared";
import type { Rule, RuleContext } from "./types.js";
import { BOTH } from "./references.js";
import { RULE_VERSION, buildDetection, isFirstObservation } from "./common.js";
import { describeMatch } from "./known-infra-common.js";

const NB: RuleDefinitionNb = {
  name: "Innebygd ramme som laster dokumentert infrastruktur",
  description:
    "En iframe inne på siden (rammedybde 1 eller mer) lastet et dokument fra en vert som er dokumentert som skadelig eller overvåkingsrelatert infrastruktur, som i det dokumenterte leveringstrinnet med skjult iframe.",
  confidenceBasis:
    "Middels: indikatortreffet er direkte, og konteksten med innebygd ramme samsvarer med det dokumenterte leveringstrinnet, men rammens formål og innhold er ikke observert.",
  limitations: [
    "Størrelsen på og synligheten til en ramme kan ikke observeres fra nettverksmetadata.",
  ],
  falsePositiveConsiderations: [
    "Annonsenettverk viser rutinemessig annonsemateriell i iframes, også på dokumenterte annonseteknologiverter.",
  ],
};

export const definition: RuleDefinition = {
  id: "ad_delivery.nested_frame_to_indicator",
  name: "Embedded frame loading documented infrastructure",
  version: RULE_VERSION,
  description:
    "An iframe inside the page (frame depth 1 or more) loaded a document from a host documented as malicious or surveillance-associated infrastructure, as in the documented hidden-iframe delivery step.",
  category: "ad_delivery_behaviour",
  severity: "elevated",
  confidence: "medium",
  confidenceBasis:
    "Medium: the indicator match is direct, and the embedded-frame context matches the documented delivery step, but the frame's purpose and content are not observed.",
  requiredEvidence: [
    "A sub_frame request at frame depth >= 1 whose destination matches a malicious or surveillance indicator.",
  ],
  requiredCapabilities: ["request_metadata", "frame_ancestry"],
  references: BOTH,
  limitations: ["Frame size and visibility are not observable from network metadata."],
  falsePositiveConsiderations: [
    "Ad networks routinely render creatives inside iframes, including on documented ad-tech hosts.",
  ],
  nb: NB,
};

export function evaluate(event: NormalizedEvent, ctx: RuleContext): Detection[] {
  if (event.resourceType !== "sub_frame" || event.frameContext.depth < 1) return [];
  if (!isFirstObservation(event, ctx) || event.eventType === "request_error") return [];
  const matches = ctx
    .indicatorMatches(event)
    .filter(
      (m) =>
        m.indicator.classification === "malicious" || m.indicator.classification === "surveillance",
    );
  if (matches.length === 0) return [];
  const host = event.destination.hostname;
  return [
    buildDetection(definition, ctx, {
      subject: host,
      confidenceRationale:
        "The indicator match and embedded-frame context are directly observed; the frame's visibility and content are not.",
      summary:
        "An embedded frame loaded content from infrastructure documented in the AdFection investigation.",
      significance:
        "The documented delivery chain injects small frames that load further content from operator infrastructure.",
      evidence: [
        {
          eventIds: [event.eventId],
          observed: `A sub-frame at depth ${event.frameContext.depth} requested this host.`,
          kind: "observed",
        },
        ...matches.map((m) => ({
          eventIds: [event.eventId],
          observed: describeMatch(m),
          kind: "observed" as const,
        })),
      ],
      events: [event],
      matchedIndicatorIds: matches.map((m) => m.indicator.id),
      subjectHostnames: [host, ...event.frameContext.ancestorHostnames.slice(0, 5)],
      alternativeExplanations: [
        "An ordinary ad creative rendered in an iframe served by this network.",
      ],
      nb: {
        confidenceRationale:
          "Indikatortreffet og konteksten med innebygd ramme er observert direkte; rammens synlighet og innhold er ikke observert.",
        summary:
          "En innebygd ramme lastet innhold fra infrastruktur som er dokumentert i AdFection-undersøkelsen.",
        significance:
          "Den dokumenterte leveringskjeden setter inn små rammer som laster mer innhold fra operatørens infrastruktur.",
        alternativeExplanations: ["Vanlig annonsemateriell vist i en iframe fra dette nettverket."],
      },
    }),
  ];
}

export const rule: Rule = { definition, evaluate };
