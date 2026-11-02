import type { RuleDefinition } from "@adtripwire/shared";
import { externalLink, h, severityBadge } from "../dom.js";
import {
  CATEGORY_ORDER,
  categoryLabel,
  confidenceLabel,
  missingCapabilitiesText,
  pluralize,
  severityLabel,
} from "../format.js";
import { t } from "../i18n.js";
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
        ? t("Evaluable in this browser.")
        : missingCapabilitiesText(entry.missingCapabilities),
    ),
    h(
      "p",
      null,
      h(
        "strong",
        null,
        t("Confidence basis ({level}): ", { level: confidenceLabel(r.confidence) }),
      ),
      r.confidenceBasis,
    ),
    h("p", null, r.description),
    h("h4", null, t("Required evidence")),
    bulletList(r.requiredEvidence, t("None listed.")),
    h("h4", null, t("Limitations")),
    bulletList(r.limitations, t("None listed.")),
    h("h4", null, t("False-positive considerations")),
    bulletList(r.falsePositiveConsiderations, t("None listed.")),
    r.references.length > 0
      ? h(
          "div",
          null,
          h("h4", null, t("References")),
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
    h("h2", null, t("Rules")),
    h(
      "p",
      { class: "muted" },
      notEvaluable > 0
        ? t("{count} loaded; {n} not evaluable in this browser.", {
            count: pluralize(entries.length, "rule"),
            n: notEvaluable,
          })
        : t("{count} loaded.", { count: pluralize(entries.length, "rule") }),
    ),
    entries.length === 0 ? h("p", null, t("No rules are loaded.")) : null,
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
