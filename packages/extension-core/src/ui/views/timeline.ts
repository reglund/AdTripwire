import type { TimelineEntry } from "@adtripwire/shared";
import { errorState, h, loadingState, replaceChildren, severityBadge } from "../dom.js";
import { formatTimestamp, severityLabel } from "../format.js";
import { t } from "../i18n.js";
import { detectionHash } from "../route.js";
import { rpc } from "../rpc.js";
import {
  DEFAULT_SINCE,
  groupByTab,
  parseTabId,
  SINCE_OPTIONS,
  sinceTimestamp,
  sortTimeline,
  tabLabel,
  TIMELINE_LIMIT,
} from "../timeline.js";
import { uid, tableWrap, type View } from "./common.js";

const COLUMNS = ["Time", "Kind", "Severity", "Rule", "Summary", "Hostname", "Frame"];

function entryRow(entry: TimelineEntry): HTMLElement {
  const summary =
    entry.kind === "detection" && entry.detectionId !== undefined
      ? h("a", { href: detectionHash(entry.detectionId) }, entry.summary)
      : entry.summary;
  return h(
    "tr",
    null,
    h(
      "td",
      { class: "nowrap" },
      h(
        "time",
        { datetime: new Date(entry.timestamp).toISOString() },
        formatTimestamp(entry.timestamp),
      ),
    ),
    h("td", null, h("span", { class: "badge kind" }, entry.kind)),
    h(
      "td",
      null,
      entry.kind === "detection" && entry.severity !== undefined
        ? severityBadge(entry.severity, severityLabel(entry.severity))
        : h("span", { class: "muted" }, "—"),
    ),
    h("td", null, entry.ruleId !== undefined ? h("code", null, entry.ruleId) : "—"),
    h("td", { class: "wrap" }, summary),
    h("td", { class: "mono wrap" }, entry.hostname ?? "—"),
    h("td", { class: "nowrap" }, entry.frameId !== undefined ? String(entry.frameId) : "—"),
  );
}

export function timelineTable(entries: readonly TimelineEntry[]): HTMLElement {
  const groups = groupByTab(sortTimeline(entries));
  return tableWrap(
    t("Timeline"),
    h(
      "table",
      { class: "data timeline" },
      h(
        "caption",
        { class: "sr-only" },
        t("Detections and supporting events, oldest first, grouped by tab"),
      ),
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          COLUMNS.map((label) => h("th", { scope: "col" }, t(label))),
        ),
      ),
      groups.map((g) =>
        h(
          "tbody",
          { class: "tl-group" },
          h(
            "tr",
            { class: "tl-group-label" },
            h("th", { scope: "colgroup", colspan: COLUMNS.length }, tabLabel(g.tabId)),
          ),
          g.entries.map(entryRow),
        ),
      ),
    ),
  );
}

export const renderTimeline: View = async () => {
  const tabInputId = uid("tl-tab");
  const sinceId = uid("tl-since");
  const tabInput = h("input", {
    type: "text",
    id: tabInputId,
    inputmode: "numeric",
    autocomplete: "off",
    "aria-describedby": `${tabInputId}-err`,
  });
  const tabError = h("p", { id: `${tabInputId}-err`, class: "field-error", role: "alert" });
  const since = h(
    "select",
    { id: sinceId },
    SINCE_OPTIONS.map((o) =>
      h("option", { value: o.key, selected: o.key === DEFAULT_SINCE }, t(o.label)),
    ),
  );
  const results = h("div", { class: "results", "aria-live": "polite" });

  let token = 0;
  const load = async (): Promise<void> => {
    const parsed = parseTabId(tabInput.value);
    if (!parsed.ok) {
      tabInput.setAttribute("aria-invalid", "true");
      tabError.textContent = t(parsed.error);
      return;
    }
    tabInput.removeAttribute("aria-invalid");
    tabError.textContent = "";
    const mine = ++token;
    replaceChildren(results, loadingState());
    const sinceTs = sinceTimestamp(since.value);
    try {
      const entries = await rpc<TimelineEntry[]>({
        type: "get_timeline",
        limit: TIMELINE_LIMIT,
        ...(parsed.tabId !== undefined ? { tabId: parsed.tabId } : {}),
        ...(sinceTs !== undefined ? { since: sinceTs } : {}),
      });
      if (mine !== token) return;
      if (entries.length === 0) {
        replaceChildren(
          results,
          h(
            "p",
            { class: "muted" },
            t(
              "No timeline entries in this selection. Only events that a detection refers to are kept, so this is not a record of all browsing or network activity.",
            ),
          ),
        );
        return;
      }
      replaceChildren(
        results,
        h(
          "p",
          { class: "muted small" },
          [
            entries.length === 1 ? t("1 entry") : t("{n} entries", { n: entries.length }),
            entries.length >= TIMELINE_LIMIT
              ? ` ${t("(limit of {limit} reached; narrow the range to see others)", { limit: TIMELINE_LIMIT })}`
              : "",
            ". ",
            t("Only events referenced by detections are kept."),
          ].join(""),
        ),
        timelineTable(entries),
      );
    } catch (err) {
      if (mine === token)
        replaceChildren(
          results,
          errorState(t("Could not load the timeline"), err, () => void load()),
        );
    }
  };

  since.addEventListener("change", () => void load());

  const form = h(
    "form",
    {
      class: "filters",
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        void load();
      },
    },
    h("div", { class: "field" }, h("label", { for: sinceId }, t("Show")), since),
    h(
      "div",
      { class: "field" },
      h("label", { for: tabInputId }, t("Tab id (optional)")),
      tabInput,
      tabError,
    ),
    h("div", { class: "field" }, h("button", { type: "submit", class: "btn" }, t("Apply"))),
  );

  await load();

  return h(
    "div",
    { class: "view" },
    h("h2", null, t("Timeline")),
    h(
      "p",
      { class: "muted" },
      t(
        "Detections and the events they refer to, oldest first, grouped by browser tab. Event rows are context for a detection, not a complete activity log.",
      ),
    ),
    form,
    results,
  );
};
