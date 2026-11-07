import type {
  Detection,
  ExportFile,
  IndicatorSet,
  NormalizedEvent,
  SensorCapabilities,
  UiRequest,
} from "@adtripwire/shared";
import {
  EXPORT_DISCLAIMER,
  SEEN_ALONGSIDE_DISCLAIMER,
  buildEvidenceExport,
  serializeExport,
} from "@adtripwire/privacy";
import type { AlongsideListing, AlongsideRow } from "@adtripwire/correlation";
import {
  addAlongsideToStix,
  detectionsToEcsNdjson,
  detectionsToStix,
  eventsToEcsNdjson,
  indicatorSetToStix,
} from "@adtripwire/interop";

export interface ResearchExportInput {
  detections: Detection[];
  events: NormalizedEvent[];
  indicatorSets: IndicatorSet[];
  notes: ReadonlyMap<string, { note: string; updatedAt: number }>;
  productVersion: string;
  rulesetVersion: string;
  browser: SensorCapabilities;
  now: Date;
  /** "Seen alongside" listing; omitted means the sections are empty. */
  alongside?: AlongsideListing;
}

export type ResearchExportRequest = Extract<
  UiRequest,
  { type: "export_stix" | "export_siem" | "export_handoff" }
>;

/** Hand-off section: hostnames, counts and indicator ids only. Never a detection. */
function seenAlongsideSection(
  listing: AlongsideListing | undefined,
  profile: "default" | "strict",
) {
  const row = (r: AlongsideRow, scope: "frame" | "page") => ({
    hostname: r.hostname,
    scope,
    alongsideDays: r.alongsideDays,
    seenDays: r.seenDays,
    share: Math.round(r.share * 1000) / 1000,
    anchors: [...r.anchors],
    frameDays: r.frameDays,
    pageDays: r.pageDays,
    lastSeen: r.lastSeen,
  });
  if (profile === "strict")
    // The strict profile pseudonymises/removes names; hostnames of unknown third parties are
    // omitted entirely rather than exported in the clear. Counts remain.
    return {
      disclaimer: SEEN_ALONGSIDE_DISCLAIMER,
      note: "The strict redaction profile omits the hostnames in this section; use the default profile to include them.",
      omitted: true,
      totals: listing?.totals ?? null,
      rows: [],
      pageOnly: [],
    };
  return {
    disclaimer: SEEN_ALONGSIDE_DISCLAIMER,
    omitted: false,
    note: "Anchors are AdTripwire indicator ids of documented hosts. Frame-scope rows count toward the ranking; page-scope rows were loaded by the top document and are listed separately.",
    totals: listing?.totals ?? null,
    rows: (listing?.rows ?? []).map((r) => row(r, "frame")),
    pageOnly: (listing?.pageOnly ?? []).map((r) => row(r, "page")),
  };
}

const stamp = (now: Date) => now.toISOString().replace(/[:.]/g, "-");

/** Builds the Phase 4 research exports (STIX 2.1, ECS NDJSON, hand-off package). */
export function exportResearch(req: ResearchExportRequest, input: ResearchExportInput): ExportFile {
  const { detections, events, indicatorSets, now } = input;
  const stixOpts = { producedAt: now };
  switch (req.type) {
    case "export_stix": {
      const bundle = detectionsToStix(detections, events, indicatorSets, stixOpts);
      if (req.includeIndicators) {
        for (const set of indicatorSets) {
          if (set.meta.synthetic) continue;
          const ib = indicatorSetToStix(set, stixOpts);
          const seen = new Set(bundle.objects.map((o) => o.id));
          for (const o of ib.objects) if (!seen.has(o.id)) bundle.objects.push(o);
        }
      }
      addAlongsideToStix(bundle, input.alongside?.rows ?? [], indicatorSets, stixOpts);
      return {
        filename: `adtripwire-${stamp(now)}.stix.json`,
        mediaType: "application/stix+json",
        text: JSON.stringify(bundle, null, 2) + "\n",
      };
    }
    case "export_siem": {
      const opts = {
        productVersion: input.productVersion,
        rulesetVersion: input.rulesetVersion,
        browser: input.browser,
        now,
        indicatorSets,
      };
      const text =
        detectionsToEcsNdjson(detections, events, opts) + eventsToEcsNdjson(events, opts);
      return {
        filename: `adtripwire-${stamp(now)}.ecs.ndjson`,
        mediaType: "application/x-ndjson",
        text,
      };
    }
    case "export_handoff": {
      const evidence = buildEvidenceExport({
        productVersion: input.productVersion,
        browser: input.browser,
        rulesetVersion: input.rulesetVersion,
        indicatorSets: indicatorSets.map((s) => s.meta),
        detections,
        events,
        profile: req.profile,
        now,
      });
      const stix = detectionsToStix(detections, events, indicatorSets, stixOpts);
      const notes = Object.fromEntries(
        detections
          .map((d) => [d.detectionId, input.notes.get(d.detectionId)] as const)
          .filter(
            (x): x is readonly [string, { note: string; updatedAt: number }] => x[1] !== undefined,
          ),
      );
      const readme = [
        "AdTripwire hand-off package",
        "",
        `Generated ${now.toISOString()} by AdTripwire ${input.productVersion} (${input.browser.browser}), ruleset ${input.rulesetVersion}.`,
        `Redaction profile: ${req.profile}.`,
        "",
        "Contents: evidence (sanitized detections and the events that support them), stix (the same",
        "detections as a STIX 2.1 bundle), notes (analyst notes typed by the user), capabilities (what",
        "the sensor could and could not observe), observations.seenAlongside (hostnames seen in the",
        "same ad frame as a documented host; leads, not detections).",
        "",
        "How to read it: each detection lists what was observed, why it matters, which rule fired,",
        "the evidence, benign explanations, limitations and references. Severity is an investigation",
        "priority, not a probability of compromise. Confidence is separate.",
        "",
        EXPORT_DISCLAIMER,
        "",
        "Suggested next steps for a helpline or analyst: compare the matched indicators with current",
        "threat intelligence, check validity windows, and if a NOAS endpoint returned JavaScript or a",
        "malicious-infrastructure contact followed an ad-selection request, consider a device-level",
        "forensic check (e.g. Zero Breach for browser artefacts, MVT for mobile devices).",
      ].join("\n");
      const pkg = {
        schema: "adtripwire.handoff",
        schemaVersion: "1.0.0",
        readme,
        evidence,
        stix,
        notes,
        observations: { seenAlongside: seenAlongsideSection(input.alongside, req.profile) },
        capabilities: input.browser,
      };
      return {
        filename: `adtripwire-handoff-${stamp(now)}.json`,
        mediaType: "application/json",
        text: serializeExport(evidence).length >= 0 ? JSON.stringify(pkg, null, 2) + "\n" : "",
      };
    }
  }
}
