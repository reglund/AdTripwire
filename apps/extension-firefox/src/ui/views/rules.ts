import type { RuleDefinition } from "@adtripwire/shared";
import { externalLink, h, severityBadge } from "../dom.js";
import {
  CATEGORY_ORDER,
  capabilityLabel,
  categoryLabel,
  confidenceLabel,
  pluralize,
  severityLabel,
} from "../format.js";
import { rpc } from "../rpc.js";
import { bulletList, type View } from "./common.js";

interface RuleEntry {
  definition: RuleDefinition;
  evaluable: boolean;
  missingCapabilities: string[];
}

function ruleItem(entry: RuleEntry): HTMLElement {
  const r = entry.definition;
  return h(
    "details",
    { class: "rule" },
    h(
      "summary",
      null,
      h("span", { class: "rule-name" }, r.name),
      " ",
      h("code", null, r.id),
      " ",
      h("span", { class: "muted" }, `v${r.version}`),
      " ",
      severityBadge(r.severity, severityLabel(r.severity)),
    ),
    h(
      "p",
      { class: entry.evaluable ? "muted" : "notice-warn" },
      entry.evaluable
        ? "Evaluable in this browser."
        : `Not evaluable in this browser (missing: ${entry.missingCapabilities.map(capabilityLabel).join(", ") || "unspecified"}).`,
    ),
    h(
      "p",
      null,
      h("strong", null, `Confidence basis (${confidenceLabel(r.confidence)}): `),
      r.confidenceBasis,
    ),
    h("p", null, r.description),
    h("h4", null, "Required evidence"),
    bulletList(r.requiredEvidence, "None listed."),
    h("h4", null, "Limitations"),
    bulletList(r.limitations, "None listed."),
    h("h4", null, "False-positive considerations"),
    bulletList(r.falsePositiveConsiderations, "None listed."),
    r.references.length > 0
      ? h(
          "div",
          null,
          h("h4", null, "References"),
          h(
            "ul",
            { class: "bullets" },
            r.references.map((ref) => h("li", null, externalLink(ref.url, ref.title))),
          ),
        )
      : null,
  );
}

export const renderRules: View = async () => {
  const entries = await rpc<RuleEntry[]>({ type: "list_rules" });
  const known = new Set<string>(CATEGORY_ORDER);
  const categories: string[] = [
    ...CATEGORY_ORDER.filter((c) => entries.some((e) => e.definition.category === c)),
    ...[...new Set(entries.map((e) => e.definition.category))].filter((c) => !known.has(c)),
  ];
  const notEvaluable = entries.filter((e) => !e.evaluable).length;

  return h(
    "div",
    { class: "view" },
    h("h2", null, "Rules"),
    h(
      "p",
      { class: "muted" },
      `${pluralize(entries.length, "rule")} loaded` +
        (notEvaluable > 0 ? `; ${notEvaluable} not evaluable in this browser.` : "."),
    ),
    entries.length === 0 ? h("p", null, "No rules are loaded.") : null,
    categories.map((cat) => {
      const id = `rules-${cat}`;
      return h(
        "section",
        { class: "card", "aria-labelledby": id },
        h("h3", { id }, categoryLabel(cat)),
        entries.filter((e) => e.definition.category === cat).map(ruleItem),
      );
    }),
  );
};
