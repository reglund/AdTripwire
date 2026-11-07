/**
 * Generates docs/phase-11-nb-review.md: for every rule, its definition in English and
 * Norwegian, and the detection text in both languages from a synthetic run that fires the rule
 * (so interpolated hostnames, indicator ids and counts are visible). For a native-reader review.
 * Run: pnpm nb:review
 *
 * Synthetic scenarios only (reserved .test hosts, fixed timestamps), taken from the detection
 * engine's test fixtures; no network and no stored data.
 */
import { writeFileSync } from "node:fs";
import type { Detection, NormalizedEvent } from "@adtripwire/shared";
import { ALL_RULES } from "@adtripwire/detection-engine";
import { Harness, T0, ev, sig } from "../packages/detection-engine/src/__test__/fixtures.js";

const NOAS_PARAMS = ["idfa", "sourceId", "dom", "page", "country", "os"];
const SCRIPT = ["js.iframe_create", "js.iframe_1x1", "js.script_inject"];
const F5 = { depth: 1, frameId: 5, parentFrameId: 0, ancestors: [0] };
const noasF5 = (t = T0): NormalizedEvent =>
  ev({ host: "noas.synthetic-adfection.test", path: "/getAd", params: NOAS_PARAMS, t, ...F5 });
const scriptF5 = (t = T0 + 500): NormalizedEvent =>
  ev({
    host: "cdn.synthetic-benign.test",
    eventType: "response_inspected",
    inspection: { markers: SCRIPT },
    t,
    ...F5,
  });
const c2F5 = (t = T0 + 2000): NormalizedEvent =>
  ev({ host: "c2.synthetic-adfection.test", t, ...F5 });
const inspected = (host: string, markers: string[]): NormalizedEvent =>
  ev({ host, eventType: "response_inspected", inspection: { markers } });
const chain = (rid: string, hosts: string[], t: number): NormalizedEvent[] => {
  const base = { rid, tab: 7, tp: ["tracking_ad" as const] };
  return [
    ev({ ...base, host: hosts[0]!, type: "image", t }),
    ...hosts.slice(0, -1).map((h, i) =>
      ev({
        ...base,
        host: h,
        eventType: "request_redirected",
        redirectHost: hosts[i + 1]!,
        t: t + i + 1,
      }),
    ),
  ];
};
const noasReq = (): NormalizedEvent =>
  ev({ host: "ads.synthetic-benign.test", path: "/getAd", params: ["idfa"] });

interface Scenario {
  label: string;
  pageSensor?: boolean;
  events: () => NormalizedEvent[];
}

const SCENARIOS: Scenario[] = [
  {
    label: "request to a documented command-and-control host",
    events: () => [ev({ host: "c2.synthetic-adfection.test" })],
  },
  {
    label: "request to a documented tracking host",
    events: () => [ev({ host: "sync.synthetic-tracking.test", type: "image" })],
  },
  {
    label: "first-party top-level request to a documented contextual host",
    events: () => [
      ev({ host: "corp.synthetic-vendor.test", type: "main_frame", thirdParty: false }),
    ],
  },
  {
    label: "NOAS-pattern request to a documented ad host",
    events: () => [
      ev({ host: "noas.synthetic-adfection.test", path: "/getAd", params: NOAS_PARAMS }),
    ],
  },
  { label: "NOAS-pattern request to an undocumented host", events: () => [noasReq()] },
  {
    label: "documented host loaded in a nested frame",
    events: () => [ev({ host: "c2.synthetic-adfection.test", type: "sub_frame", depth: 1 })],
  },
  {
    label: "NOAS request with a non-empty response",
    events: () => [
      noasReq(),
      {
        ...noasReq(),
        eventId: "c1",
        eventType: "request_completed",
        requestStatus: "completed",
        responseSizeIfObservable: 900,
        timestamp: T0 + 10,
      },
    ],
  },
  {
    label: "redirect chain through four hosts, then a documented host",
    events: () => [
      ...chain(
        "s1",
        [
          "a.synthetic-ads1.test",
          "b.synthetic-ads2.test",
          "c.synthetic-ads3.test",
          "d.synthetic-ads4.test",
        ],
        T0,
      ),
      ...chain(
        "s2",
        [
          "a.synthetic-ads1.test",
          "sync.synthetic-tracking.test",
          "c.synthetic-ads3.test",
          "d.synthetic-ads4.test",
        ],
        T0 + 1000,
      ),
    ],
  },
  {
    label: "NOAS, script and documented host in one ad frame",
    events: () => [noasF5(), scriptF5(), c2F5()],
  },
  {
    label: "script and documented host in one ad frame, no NOAS",
    events: () => [scriptF5(), c2F5()],
  },
  {
    label: "NOAS followed by a loader frame",
    events: () => [
      noasF5(),
      ev({
        host: "d111.synthetic-cdn.test",
        path: "/iframe",
        params: ["impid"],
        type: "sub_frame",
        t: T0 + 1500,
        depth: 2,
        frameId: 9,
        parentFrameId: 5,
        ancestors: [5, 0],
      }),
    ],
  },
  {
    label: "three distinct days of contact with a documented tracking host",
    events: () =>
      Array.from({ length: 3 }, (_, i) =>
        ev({ host: "sync.synthetic-tracking.test", type: "image", t: T0 + i * 86_400_000 }),
      ),
  },
  {
    label: "identifier-rich request",
    events: () => [ev({ host: "t.synthetic-benign.test", params: ["idfa", "ipv4", "lat", "w"] })],
  },
  {
    label: "fingerprinting classification near a NOAS request",
    events: () => [
      noasReq(),
      ev({ host: "fp.synthetic-benign.test", tp: ["fingerprinting"], t: T0 + 1000 }),
    ],
  },
  {
    label: "dynamic code with transport markers",
    events: () => [
      inspected("d1.synthetic-benign.test", [
        "js.new_function",
        "js.timer_polling",
        "js.aes_cbc",
        "js.colocated_dynamic_transport",
      ]),
    ],
  },
  {
    label: "cookie read and exfiltration markers",
    events: () => [
      inspected("d3.synthetic-benign.test", [
        "js.cookie_read",
        "js.cookie_tilde_join",
        "js.colocated_cookie_exfil",
      ]),
    ],
  },
  {
    label: "DNS-over-HTTPS then raw-IP markers",
    events: () => [inspected("d4.synthetic-benign.test", ["js.doh_cloudflare", "js.raw_ip_fetch"])],
  },
  {
    label: "anti-analysis markers",
    events: () => [
      inspected("d5.synthetic-benign.test", ["js.error_stack_trap", "js.obfuscation_bang_bracket"]),
    ],
  },
  {
    label: "hidden-frame markers",
    events: () => [inspected("d6.synthetic-benign.test", ["js.iframe_create", "js.iframe_1x1"])],
  },
  {
    label: "SDK markers",
    events: () => [
      inspected("d7.synthetic-benign.test", ["js.adfection_sdk_auth", "js.adfection_sdk_ready"]),
    ],
  },
  {
    label: "SDK-ready message from a sub-frame (page sensor)",
    pageSensor: true,
    events: () => [sig("postmessage_sdk_ready", F5)],
  },
  {
    label: "hidden frame inserted after load (page sensor)",
    pageSensor: true,
    events: () => [
      sig("hidden_iframe_inserted", { ...F5, crossOrigin: true, target: "x.synthetic-cdn.test" }),
    ],
  },
  {
    label: "late third-party script after a NOAS request (page sensor)",
    pageSensor: true,
    events: () => [noasF5(), sig("script_inserted", { ...F5, crossOrigin: true, t: T0 + 600 })],
  },
];

interface Fired {
  detection: Detection;
  label: string;
}

/** First synthetic scenario that fires each rule (latest version of the detection). */
function runScenarios(): { fired: Map<string, Fired>; errors: string[] } {
  const fired = new Map<string, Fired>();
  const errors: string[] = [];
  for (const sc of SCENARIOS) {
    try {
      const h = new Harness(sc.pageSensor ? { pageSensor: true } : {});
      const out: Detection[] = [];
      for (const e of sc.events()) {
        const r = h.ingest(e);
        out.push(...r.detections, ...r.updated);
      }
      for (const d of out)
        fired.set(`${sc.label}\u0000${d.ruleId}`, { detection: d, label: sc.label });
    } catch (err) {
      errors.push(`${sc.label}: ${(err as Error).message}`);
    }
  }
  const first = new Map<string, Fired>();
  for (const f of fired.values())
    if (!first.has(f.detection.ruleId)) first.set(f.detection.ruleId, f);
  return { fired: first, errors };
}

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const list = (items: readonly string[]): string =>
  items.length === 0 ? "(none)" : items.map((x, i) => `${i + 1}. ${cell(x)}`).join("<br>");
const NOT_TRANSLATED = "_not yet translated_";

function table(rows: Array<[string, string, string]>): string[] {
  return [
    "| Field | English | Norwegian |",
    "|---|---|---|",
    ...rows.map(([f, e, n]) => `| ${f} | ${e} | ${n} |`),
    "",
  ];
}

const { fired, errors } = runScenarios();
const lines: string[] = [];
lines.push("# Phase 11: Norwegian rule text, review document", "");
lines.push(
  "<!-- GENERATED by scripts/nb-review.ts (pnpm nb:review). Edit the rules, not this file. -->",
  "",
);
const withDefNb = ALL_RULES.filter((r) => r.definition.nb).length;
const withDetNb = [...fired.values()].filter((f) => f.detection.nb).length;
lines.push(
  `Rules: ${ALL_RULES.length}. Definitions with Norwegian text: ${withDefNb}. Synthetic detections with Norwegian text: ${withDetNb} of ${fired.size} rules fired.`,
  "",
  "Each rule shows its definition (English and Norwegian) and, under it, the detection text from a synthetic run that fires the rule. Hostnames ending in `.test` are synthetic. Lists are numbered and must have the same length in both languages. Evidence lines (`evidence[].observed`) are not translated.",
  "",
);
if (errors.length > 0) {
  lines.push("## Scenario errors", "");
  for (const e of errors) lines.push(`- ${cell(e)}`);
  lines.push("");
}
for (const r of ALL_RULES) {
  const d = r.definition;
  const nb = d.nb;
  lines.push(`## \`${d.id}\``, "");
  lines.push(
    `Category ${d.category} · default severity ${d.severity} · confidence ${d.confidence} · v${d.version}`,
    "",
  );
  lines.push("### Definition", "");
  if (!nb) lines.push(`Norwegian definition: ${NOT_TRANSLATED}`, "");
  lines.push(
    ...table([
      ["name", cell(d.name), nb ? cell(nb.name) : NOT_TRANSLATED],
      ["description", cell(d.description), nb ? cell(nb.description) : NOT_TRANSLATED],
      ["confidenceBasis", cell(d.confidenceBasis), nb ? cell(nb.confidenceBasis) : NOT_TRANSLATED],
      ["limitations", list(d.limitations), nb ? list(nb.limitations) : NOT_TRANSLATED],
      [
        "falsePositiveConsiderations",
        list(d.falsePositiveConsiderations),
        nb ? list(nb.falsePositiveConsiderations) : NOT_TRANSLATED,
      ],
    ]),
  );
  const f = fired.get(d.id);
  lines.push("### Detection text", "");
  if (!f) {
    lines.push("No synthetic run fires this rule; detection text not shown.", "");
    continue;
  }
  const det = f.detection;
  lines.push(`Synthetic run: ${f.label} (${det.severity}, ${det.confidence}).`, "");
  const dn = det.nb;
  if (!dn) lines.push(`Norwegian detection text: ${NOT_TRANSLATED}`, "");
  lines.push(
    ...table([
      ["summary", cell(det.summary), dn ? cell(dn.summary) : NOT_TRANSLATED],
      ["significance", cell(det.significance), dn ? cell(dn.significance) : NOT_TRANSLATED],
      [
        "confidenceRationale",
        cell(det.confidenceRationale),
        dn ? cell(dn.confidenceRationale) : NOT_TRANSLATED,
      ],
      [
        "alternativeExplanations",
        list(det.alternativeExplanations),
        dn ? list(dn.alternativeExplanations) : NOT_TRANSLATED,
      ],
      [
        "recommendedActions",
        list(det.recommendedActions),
        dn ? list(dn.recommendedActions) : NOT_TRANSLATED,
      ],
      ["limitations", list(det.limitations), dn ? list(dn.limitations) : NOT_TRANSLATED],
      [
        "missingVisibility",
        list(det.missingVisibility),
        dn ? list(dn.missingVisibility) : NOT_TRANSLATED,
      ],
    ]),
  );
}

const target = "docs/phase-11-nb-review.md";
writeFileSync(target, lines.join("\n") + "\n");
console.log(
  `wrote ${target}: ${ALL_RULES.length} rules, ${withDefNb} with nb definitions, ${withDetNb}/${fired.size} fired detections with nb`,
);
if (fired.size < ALL_RULES.length)
  console.log(
    `no synthetic run for: ${ALL_RULES.filter((r) => !fired.has(r.definition.id))
      .map((r) => r.definition.id)
      .join(", ")}`,
  );
