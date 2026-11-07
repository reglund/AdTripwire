/**
 * "Related activity": deterministic clusters of detections that share infrastructure,
 * evidence or a tab/time window, with a templated timeline narrative and suggested
 * investigative actions. Everything shown here is derived from stored detections; the
 * optional local-model panel sits at the bottom and is labelled as interpretation.
 */
import type {
  ClusterDetail,
  DetectionCluster,
  Settings,
  SuggestedAction,
} from "@adtripwire/shared";
import { h, severityBadge } from "../dom.js";
import {
  categoryLabel,
  formatHostnames,
  formatTimestamp,
  pluralize,
  severityLabel,
} from "../format.js";
import { currentLanguage, t } from "../i18n.js";
import { detectionRuleName, detectionText } from "../detection-text.js";
import { clusterHash } from "../route.js";
import { shareSheet } from "./share-sheet.js";
import { rpc } from "../rpc.js";
import { assistPanel } from "../assist/panel.js";
import {
  bulletList,
  card,
  detectionsTable,
  kv,
  loadRuleNames,
  tableWrap,
  timeEl,
  type View,
} from "./common.js";

const PRIORITY_LABEL: Record<SuggestedAction["priority"], string> = {
  now: "Now",
  soon: "Soon",
  optional: "Optional",
};

const REASON_LABEL: Record<DetectionCluster["links"][number]["reason"], string> = {
  shared_event: "same observed request",
  shared_indicator: "same indicator",
  shared_hostname: "same hostname",
  shared_domain: "related domain",
  same_tab_window: "same tab, within the correlation window",
};

export function clustersTable(clusters: readonly DetectionCluster[]): HTMLElement {
  const head = h(
    "tr",
    null,
    ["Latest", "Priority", "Detections", "Rules", "Hostnames", "Summary"].map((label) =>
      h("th", { scope: "col" }, t(label)),
    ),
  );
  const rows = clusters.map((c) =>
    h(
      "tr",
      {
        class: "clickable",
        onclick: (ev: Event) => {
          if (!(ev.target instanceof Element && ev.target.closest("a")))
            location.hash = clusterHash(c.clusterId);
        },
      },
      h("td", { class: "nowrap" }, timeEl(c.lastTimestamp)),
      h("td", null, severityBadge(c.maxSeverity, severityLabel(c.maxSeverity))),
      h("td", null, String(c.detectionIds.length)),
      h("td", null, String(c.ruleIds.length)),
      h("td", { class: "mono" }, formatHostnames(c.hostnames)),
      h("td", { class: "wrap" }, h("a", { href: clusterHash(c.clusterId) }, c.summary)),
    ),
  );
  return tableWrap(
    t("Related activity"),
    h(
      "table",
      { class: "data" },
      h("caption", { class: "sr-only" }, t("Clusters of related detections, newest first")),
      h("thead", null, head),
      h("tbody", null, rows),
    ),
  );
}

export const renderCorrelation: View = async () => {
  const clusters = await rpc<DetectionCluster[]>({ type: "get_clusters" });
  const multi = clusters.filter((c) => c.detectionIds.length > 1).length;
  return h(
    "div",
    { class: "view" },
    h("h2", null, t("Related activity")),
    h(
      "p",
      null,
      t(
        "Detections are grouped when they cite the same request, matched the same indicator, name the same hostname or domain, or occurred in the same tab within the correlation window. Grouping is deterministic and adds no new findings.",
      ),
    ),
    clusters.length === 0
      ? h("p", { class: "muted" }, t("No detections recorded, so nothing to group."))
      : h(
          "div",
          null,
          h(
            "p",
            { class: "muted" },
            t("{count}, of which {n} contain more than one detection.", {
              count: pluralize(clusters.length, "group"),
              n: multi,
            }),
          ),
          clustersTable(clusters),
        ),
  );
};

export function actionsSection(detail: ClusterDetail): HTMLElement {
  const a = detail.actions;
  return card(
    t("Suggested investigative actions"),
    h("p", { class: "muted small" }, a.disclaimer),
    h(
      "ol",
      { class: "actions" },
      a.actions.map((x) =>
        h(
          "li",
          null,
          h("span", { class: `badge priority-${x.priority}` }, t(PRIORITY_LABEL[x.priority])),
          " ",
          h("strong", null, x.text),
          h("div", { class: "muted small" }, t("Because: {reason}", { reason: x.rationale })),
        ),
      ),
    ),
    a.fromRules.length > 0
      ? h(
          "div",
          null,
          h("h4", null, t("Also recommended by the rules involved")),
          bulletList(a.fromRules, ""),
        )
      : null,
  );
}

/**
 * In nb mode a detection step is rebuilt from the nb rule name and summary; the correlation
 * package's English step text is used when the detection has no nb text.
 */
function stepText(
  s: ClusterDetail["timeline"]["steps"][number],
  detail: ClusterDetail,
  ruleNames: ReadonlyMap<string, string>,
): string {
  if (currentLanguage() !== "nb" || s.kind !== "detection" || !s.severity) return s.text;
  const d = detail.detections.find((x) => x.detectionId === s.detectionId);
  if (!d) return s.text;
  const text = detectionText(d, "nb");
  if (text.fallback) return s.text;
  return `${detectionRuleName(d, ruleNames)} (${severityLabel(s.severity)}): ${text.summary}`;
}

export function timelineSection(
  detail: ClusterDetail,
  ruleNames: ReadonlyMap<string, string> = new Map(),
): HTMLElement {
  const tl = detail.timeline;
  return card(
    t("Timeline summary"),
    h("p", null, tl.text),
    tl.steps.length > 0
      ? tableWrap(
          t("Timeline steps"),
          h(
            "table",
            { class: "data" },
            h("caption", { class: "sr-only" }, t("Timeline steps in order")),
            h(
              "thead",
              null,
              h(
                "tr",
                null,
                ["Offset", "Time", "Kind", "What"].map((x) => h("th", { scope: "col" }, t(x))),
              ),
            ),
            h(
              "tbody",
              null,
              tl.steps.map((s) =>
                h(
                  "tr",
                  null,
                  h("td", { class: "nowrap mono" }, `+${Math.round(s.offsetMs / 1000)} s`),
                  h("td", { class: "nowrap" }, formatTimestamp(s.timestamp)),
                  h(
                    "td",
                    null,
                    s.kind === "detection" && s.severity
                      ? severityBadge(s.severity, severityLabel(s.severity))
                      : h("span", { class: "badge kind" }, t("event")),
                  ),
                  h("td", { class: "wrap" }, stepText(s, detail, ruleNames)),
                ),
              ),
            ),
          ),
        )
      : null,
  );
}

export async function renderClusterDetail(clusterId: string): Promise<Node> {
  const [detail, settings, ruleNames] = await Promise.all([
    rpc<ClusterDetail | null>({ type: "get_cluster", clusterId }),
    rpc<Settings>({ type: "get_settings" }),
    loadRuleNames(),
  ]);
  const back = h("p", null, h("a", { href: "#correlation" }, t("← All related activity")));
  if (!detail) {
    return h(
      "div",
      { class: "view" },
      back,
      h("h2", null, t("Group not found")),
      h(
        "p",
        { class: "muted" },
        t(
          "This group no longer exists; its detections may have been removed by retention or the grouping changed.",
        ),
      ),
    );
  }
  const c = detail.cluster;
  return h(
    "div",
    { class: "view cluster-detail" },
    back,
    h(
      "h2",
      null,
      t("Related activity: {count}", { count: pluralize(c.detectionIds.length, "detection") }),
    ),
    h(
      "div",
      { class: "detail-meta" },
      severityBadge(c.maxSeverity, severityLabel(c.maxSeverity)),
      h("span", null, `${formatTimestamp(c.firstTimestamp)} – ${formatTimestamp(c.lastTimestamp)}`),
      h(
        "span",
        null,
        c.tabIds.length === 0 ? t("no tab recorded") : pluralize(c.tabIds.length, "tab"),
      ),
    ),
    card(
      t("Summary"),
      h("p", null, c.summary),
      kv([
        [t("Categories"), c.categories.map(categoryLabel).join(", ") || "—"],
        [t("Rules"), c.ruleIds.join(", ")],
        [t("Hostnames"), h("span", { class: "mono" }, c.hostnames.join(", ") || "—")],
        [
          t("Registrable domains"),
          h("span", { class: "mono" }, c.registrableDomains.join(", ") || "—"),
        ],
        [t("Matched indicators"), c.indicatorIds.join(", ") || t("none")],
        [
          t("Why grouped"),
          c.links.length === 0
            ? t("Single detection")
            : h(
                "ul",
                { class: "bullets" },
                c.links.map((l) => h("li", null, `${t(REASON_LABEL[l.reason])} (${l.key})`)),
              ),
        ],
      ]),
    ),
    detectionsTable(detail.detections, t("Detections in this group")),
    card(t("Share with a specialist"), shareSheet({ detectionIds: c.detectionIds })),
    timelineSection(detail, ruleNames),
    actionsSection(detail),
    assistPanel({ clusterId }, settings),
  );
}
