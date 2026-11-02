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
import { t } from "../i18n.js";
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
          filtered
            ? t("{count} match the filters.", { count: pluralize(sorted.length, "detection") })
            : t("{count} recorded.", { count: pluralize(sorted.length, "detection") }),
        ),
        sorted.length === 0
          ? h(
              "p",
              null,
              filtered
                ? t("No detections match these filters.")
                : t(
                    "No detections recorded. This does not establish that nothing relevant occurred; see the Overview for what this tool can and cannot see.",
                  ),
            )
          : detectionsTable(sorted, t("Detections, newest first")),
      );
    } catch (err) {
      replaceChildren(
        results,
        errorState(t("Could not load detections"), err, () => void refresh()),
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
      options.map(([v, text]) => h("option", { value: v, selected: v === current }, text)),
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
      h("legend", null, t("Category")),
      h("div", { class: "checks" }, categoryBoxes),
    ),
    select(
      t("Severity (at least)"),
      [
        ["any", t("Any")],
        ...SEVERITY_ORDER.map((s): [string, string] => [s, t(SEVERITY_LABELS[s])]),
      ],
      state.minSeverity,
      (v) => {
        state.minSeverity = SEVERITY_ORDER.find((s) => s === v) ?? "any";
      },
    ),
    select(
      t("Confidence (at least)"),
      [
        ["any", t("Any")],
        ...CONFIDENCE_ORDER.map((c): [string, string] => [c, t(CONFIDENCE_LABELS[c])]),
      ],
      state.minConfidence,
      (v) => {
        state.minConfidence = CONFIDENCE_ORDER.find((c) => c === v) ?? "any";
      },
    ),
    select(
      t("Since"),
      SINCE_OPTIONS.map((o): [string, string] => [o.key, t(o.label)]),
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
      t("Reset filters"),
    ),
  );

  await refresh();
  return h(
    "div",
    { class: "view" },
    h("h2", null, t("Detections")),
    h(
      "p",
      { class: "muted" },
      t("Severity is an investigation priority, not a probability of compromise."),
    ),
    form,
    results,
  );
};
