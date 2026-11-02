import type { Detection, MonitoringStatus } from "@adtripwire/shared";
import { h, severityBadge, type Child } from "../dom.js";
import {
  categoryLabel,
  confidenceLabel,
  formatHostnames,
  formatTimestamp,
  monitoringPill,
  PILL_TEXT,
  relativeTime,
  severityLabel,
} from "../format.js";
import { detectionHash } from "../route.js";

export interface ViewContext {
  /** Re-render the current route from scratch (re-fetching data). */
  reload: () => void;
}

export type View = (ctx: ViewContext) => Promise<Node>;

let idCounter = 0;
/** Unique DOM id for label/description wiring. */
export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Titled section. Uses h3; each view supplies its own h2. */
export function card(title: string, ...children: Child[]): HTMLElement {
  const id = uid("card");
  return h("section", { class: "card", "aria-labelledby": id }, h("h3", { id }, title), children);
}

export function bulletList(items: readonly string[], emptyText: string): HTMLElement {
  if (items.length === 0) return h("p", { class: "muted" }, emptyText);
  return h(
    "ul",
    { class: "bullets" },
    items.map((i) => h("li", null, i)),
  );
}

export function chips(items: readonly string[], emptyText: string): HTMLElement {
  if (items.length === 0) return h("p", { class: "muted" }, emptyText);
  return h(
    "ul",
    { class: "chips" },
    items.map((i) => h("li", { class: "chip" }, i)),
  );
}

/** Definition list from label/value pairs. */
export function kv(rows: Array<[string, Child | Child[]]>): HTMLElement {
  return h(
    "dl",
    { class: "kv" },
    rows.map(([k, v]) => h("div", { class: "kv-row" }, h("dt", null, k), h("dd", null, v))),
  );
}

export function statusPill(status: Pick<MonitoringStatus, "monitoring" | "hostPermissionGranted">) {
  const state = monitoringPill(status);
  return h("span", { class: `pill pill-${state}` }, PILL_TEXT[state]);
}

export function timeEl(timestamp: number): HTMLElement {
  return h(
    "time",
    { datetime: new Date(timestamp).toISOString(), title: formatTimestamp(timestamp) },
    relativeTime(timestamp),
  );
}

export function tableWrap(label: string, table: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "table-wrap", role: "region", "aria-label": label, tabindex: "0" },
    table,
  );
}

export function newestFirst(detections: readonly Detection[]): Detection[] {
  return [...detections].sort((a, b) => b.timestamp - a.timestamp);
}

/** Detection list table. Each summary is a real link so rows are keyboard reachable. */
export function detectionsTable(detections: readonly Detection[], caption: string): HTMLElement {
  const head = h(
    "tr",
    null,
    ["Time", "Severity", "Confidence", "Category", "Summary", "Subject hostnames"].map((t) =>
      h("th", { scope: "col" }, t),
    ),
  );
  const rows = detections.map((d) => {
    const go = () => {
      location.hash = detectionHash(d.detectionId);
    };
    return h(
      "tr",
      {
        class: "clickable",
        onclick: (ev: Event) => {
          if (!(ev.target instanceof Element && ev.target.closest("a"))) go();
        },
      },
      h("td", { class: "nowrap" }, timeEl(d.timestamp)),
      h("td", null, severityBadge(d.severity, severityLabel(d.severity))),
      h("td", null, confidenceLabel(d.confidence)),
      h("td", null, categoryLabel(d.category)),
      h(
        "td",
        null,
        h("a", { href: detectionHash(d.detectionId) }, d.summary),
        d.occurrenceCount > 1
          ? h("span", { class: "muted" }, ` (seen ${d.occurrenceCount} times)`)
          : null,
      ),
      h("td", { class: "mono" }, formatHostnames(d.subjectHostnames)),
    );
  });
  return tableWrap(
    caption,
    h(
      "table",
      { class: "data" },
      h("caption", { class: "sr-only" }, caption),
      h("thead", null, head),
      h("tbody", null, rows),
    ),
  );
}

/** Redaction profile chooser shared by the detection and settings exports. */
export function profileSelect(): { el: HTMLElement; value: () => "default" | "strict" } {
  const id = uid("profile");
  const select = h(
    "select",
    { id, "aria-describedby": `${id}-help` },
    h("option", { value: "default" }, "Default (sanitized hostnames)"),
    h("option", { value: "strict" }, "Strict (pseudonymised hostnames)"),
  );
  const el = h(
    "div",
    { class: "field-inline" },
    h("label", { for: id }, "Redaction profile"),
    select,
    h(
      "span",
      { id: `${id}-help`, class: "muted small" },
      "Neither profile includes cookie values, full URLs, or page content.",
    ),
  );
  return { el, value: () => (select.value === "strict" ? "strict" : "default") };
}
