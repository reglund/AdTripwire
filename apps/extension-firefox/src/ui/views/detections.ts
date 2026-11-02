import type { Detection } from "@adtripwire/shared";
import { errorState, h, loadingState, replaceChildren } from "../dom.js";
import {
  defaultFilterState,
  SINCE_OPTIONS,
  toDetectionFilter,
  type FilterState,
  type SinceKey,
} from "../filter.js";
import {
  CATEGORY_ORDER,
  CONFIDENCE_LABELS,
  CONFIDENCE_ORDER,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  categoryLabel,
  pluralize,
} from "../format.js";
import { rpc } from "../rpc.js";
import { detectionsTable, newestFirst, uid, type View } from "./common.js";

/** Kept across navigations within the page session so returning from a detail keeps filters. */
const state: FilterState = defaultFilterState();

export const renderDetections: View = async (ctx) => {
  const results = h("div", { class: "results", "aria-live": "polite" });

  const refresh = async (): Promise<void> => {
    replaceChildren(results, loadingState());
    try {
      const list = await rpc<Detection[]>({
        type: "list_detections",
        filter: toDetectionFilter(state),
      });
      const sorted = newestFirst(list);
      const filtered =
        state.categories.length > 0 ||
        state.minSeverity !== "any" ||
        state.minConfidence !== "any" ||
        state.since !== "all";
      replaceChildren(
        results,
        h(
          "p",
          { class: "muted", role: "status" },
          pluralize(sorted.length, "detection") + (filtered ? " match the filters." : " recorded."),
        ),
        sorted.length === 0
          ? h(
              "p",
              null,
              filtered
                ? "No detections match these filters."
                : "No detections recorded. This does not establish that nothing relevant occurred; see the Overview for what this tool can and cannot see.",
            )
          : detectionsTable(sorted, "Detections, newest first"),
      );
    } catch (err) {
      replaceChildren(
        results,
        errorState("Could not load detections", err, () => void refresh()),
      );
    }
  };

  const categoryBoxes = CATEGORY_ORDER.map((cat) => {
    const id = uid("cat");
    const box = h("input", {
      type: "checkbox",
      id,
      value: cat,
      checked: state.categories.includes(cat),
      onchange: () => {
        state.categories = CATEGORY_ORDER.filter((c) =>
          c === cat ? box.checked : state.categories.includes(c),
        );
        void refresh();
      },
    });
    return h("label", { class: "check", for: id }, box, categoryLabel(cat));
  });

  const select = (
    label: string,
    options: Array<[string, string]>,
    current: string,
    onChange: (v: string) => void,
  ): HTMLElement => {
    const id = uid("sel");
    const el = h(
      "select",
      {
        id,
        onchange: () => {
          onChange(el.value);
          void refresh();
        },
      },
      options.map(([v, t]) => h("option", { value: v, selected: v === current }, t)),
    );
    return h("div", { class: "field" }, h("label", { for: id }, label), el);
  };

  const form = h(
    "form",
    {
      class: "filters",
      onsubmit: (ev: Event) => ev.preventDefault(),
    },
    h(
      "fieldset",
      null,
      h("legend", null, "Category"),
      h("div", { class: "checks" }, categoryBoxes),
    ),
    select(
      "Severity (at least)",
      [["any", "Any"], ...SEVERITY_ORDER.map((s): [string, string] => [s, SEVERITY_LABELS[s]])],
      state.minSeverity,
      (v) => {
        state.minSeverity = SEVERITY_ORDER.find((s) => s === v) ?? "any";
      },
    ),
    select(
      "Confidence (at least)",
      [["any", "Any"], ...CONFIDENCE_ORDER.map((c): [string, string] => [c, CONFIDENCE_LABELS[c]])],
      state.minConfidence,
      (v) => {
        state.minConfidence = CONFIDENCE_ORDER.find((c) => c === v) ?? "any";
      },
    ),
    select(
      "Since",
      SINCE_OPTIONS.map((o): [string, string] => [o.key, o.label]),
      state.since,
      (v) => {
        state.since = (SINCE_OPTIONS.find((o) => o.key === v)?.key ?? "all") as SinceKey;
      },
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn",
        onclick: () => {
          Object.assign(state, defaultFilterState());
          ctx.reload();
        },
      },
      "Reset filters",
    ),
  );

  await refresh();
  return h(
    "div",
    { class: "view" },
    h("h2", null, "Detections"),
    h(
      "p",
      { class: "muted" },
      "Severity is an investigation priority, not a probability of compromise.",
    ),
    form,
    results,
  );
};
