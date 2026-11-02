import type { TimelineEntry } from "@adtripwire/shared";
import { errorState, h, loadingState, replaceChildren, severityBadge } from "../dom.js";
import { formatTimestamp, severityLabel } from "../format.js";
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
    "Timeline",
    h(
      "table",
      { class: "data timeline" },
      h(
        "caption",
        { class: "sr-only" },
        "Detections and supporting events, oldest first, grouped by tab",
      ),
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          COLUMNS.map((t) => h("th", { scope: "col" }, t)),
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
      h("option", { value: o.key, selected: o.key === DEFAULT_SINCE }, o.label),
    ),
  );
  const results = h("div", { class: "results", "aria-live": "polite" });

  let token = 0;
  const load = async (): Promise<void> => {
    const parsed = parseTabId(tabInput.value);
    if (!parsed.ok) {
      tabInput.setAttribute("aria-invalid", "true");
      tabError.textContent = parsed.error;
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
            "No timeline entries in this selection. Only events that a detection refers to are kept, so this is not a record of all browsing or network activity.",
          ),
        );
        return;
      }
      replaceChildren(
        results,
        h(
          "p",
          { class: "muted small" },
          `${entries.length} ${entries.length === 1 ? "entry" : "entries"}${entries.length >= TIMELINE_LIMIT ? ` (limit of ${TIMELINE_LIMIT} reached; narrow the range to see others)` : ""}. Only events referenced by detections are kept.`,
        ),
        timelineTable(entries),
      );
    } catch (err) {
      if (mine === token)
        replaceChildren(
          results,
          errorState("Could not load the timeline", err, () => void load()),
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
    h("div", { class: "field" }, h("label", { for: sinceId }, "Show"), since),
    h(
      "div",
      { class: "field" },
      h("label", { for: tabInputId }, "Tab id (optional)"),
      tabInput,
      tabError,
    ),
    h("div", { class: "field" }, h("button", { type: "submit", class: "btn" }, "Apply")),
  );

  await load();

  return h(
    "div",
    { class: "view" },
    h("h2", null, "Timeline"),
    h(
      "p",
      { class: "muted" },
      "Detections and the events they refer to, oldest first, grouped by browser tab. Event rows are context for a detection, not a complete activity log.",
    ),
    form,
    results,
  );
};
