import type { MonitoringStatus } from "@adtripwire/shared";
import { externalLink, h } from "../dom.js";
import { rpc } from "../rpc.js";
import { card, kv, type View } from "./common.js";

export const renderIndicators: View = async () => {
  const status = await rpc<MonitoringStatus>({ type: "get_status" });
  const sets = status.indicatorSets;
  const synthetic = sets.filter((s) => s.synthetic);

  return h(
    "div",
    { class: "view" },
    h("h2", null, "Indicators"),
    synthetic.length > 0
      ? h(
          "div",
          { class: "banner banner-warn", role: "alert" },
          h("strong", null, "Synthetic indicator set loaded. "),
          `${synthetic.map((s) => s.name).join(", ")} contain${synthetic.length === 1 ? "s" : ""} test data, not real indicators. Observations matched against it do not reflect any documented infrastructure.`,
        )
      : null,
    h(
      "p",
      { class: "muted" },
      "Indicator updates: bundled with the extension; no remote fetching in this version.",
    ),
    sets.length === 0
      ? h("p", null, "No indicator sets are loaded. Known-infrastructure rules cannot match.")
      : sets.map((s) =>
          card(
            s.name,
            kv([
              ["Set ID", h("code", null, s.id)],
              ["Version", s.version],
              ["As of", s.asOf],
              ["License", s.license],
              [
                "Type",
                s.synthetic
                  ? h("span", { class: "badge badge-warn" }, "Synthetic (test data)")
                  : "Curated from published sources",
              ],
            ]),
            s.description ? h("p", null, s.description) : null,
            h("h4", null, "Sources"),
            s.sources.length === 0
              ? h("p", { class: "muted" }, "No sources listed.")
              : h(
                  "ul",
                  { class: "bullets" },
                  s.sources.map((src) =>
                    h(
                      "li",
                      null,
                      externalLink(src.url, src.name),
                      src.published ? ` (published ${src.published})` : "",
                    ),
                  ),
                ),
          ),
        ),
  );
};
