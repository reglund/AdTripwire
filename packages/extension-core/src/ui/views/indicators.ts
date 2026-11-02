import type { ImportResult, MonitoringStatus } from "@adtripwire/shared";
import { errorMessage, externalLink, h, replaceChildren } from "../dom.js";
import { checkImportFile, importSummary, isImportResult } from "../exports.js";
import { rpc } from "../rpc.js";
import { card, kv, uid, type View } from "./common.js";

type SetMeta = MonitoringStatus["indicatorSets"][number];

export const IMPORT_NOTICE =
  "Imported sets are validated like the bundled set; indicators on shared-hosting apexes or reserved test names are rejected. Imports are local files only; the extension never fetches indicators.";

/** Enable/disable toggle and two-click Remove for an imported set. */
function importedControls(s: SetMeta, apply: (status: MonitoringStatus) => void): HTMLElement {
  const id = uid("set-enabled");
  const status = h("p", { class: "muted", role: "status" });
  const actions = h("div", { class: "button-row" });
  const enabled = s.enabled !== false;
  const toggle = h("input", { type: "checkbox", id, checked: enabled });
  const busy = (on: boolean): void => {
    for (const el of Array.from(actions.querySelectorAll("button"))) el.disabled = on;
    toggle.disabled = on;
  };

  toggle.addEventListener("change", () => {
    busy(true);
    status.textContent = "Saving…";
    void (async () => {
      try {
        const next = await rpc<MonitoringStatus>({
          type: "set_indicator_set_enabled",
          setId: s.id,
          enabled: toggle.checked,
        });
        apply(next);
      } catch (err) {
        toggle.checked = !toggle.checked;
        status.textContent = `Could not change the set: ${errorMessage(err)}`;
        busy(false);
      }
    })();
  });

  const showInitial = (): void => {
    const remove = h(
      "button",
      { type: "button", class: "btn btn-danger", onclick: showConfirm },
      "Remove set",
    );
    replaceChildren(actions, remove);
  };
  function showConfirm(): void {
    status.textContent = "";
    const cancel = h("button", { type: "button", class: "btn", onclick: showInitial }, "Cancel");
    const confirm = h(
      "button",
      {
        type: "button",
        class: "btn btn-danger",
        onclick: () => {
          busy(true);
          status.textContent = "Removing…";
          void (async () => {
            try {
              apply(await rpc<MonitoringStatus>({ type: "remove_indicator_set", setId: s.id }));
            } catch (err) {
              status.textContent = `Could not remove the set: ${errorMessage(err)}`;
              busy(false);
              showInitial();
            }
          })();
        },
      },
      "Confirm removal",
    );
    replaceChildren(actions, confirm, cancel);
    status.textContent =
      "This removes the imported set from this browser. Click Confirm removal to continue.";
    cancel.focus();
  }
  showInitial();

  return h(
    "div",
    { class: "imported-controls" },
    h(
      "div",
      { class: "field field-check" },
      h("label", { for: id }, toggle, "Enabled for matching"),
    ),
    actions,
    status,
  );
}

function setCard(s: SetMeta, apply: (status: MonitoringStatus) => void): HTMLElement {
  return card(
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
          : s.imported
            ? h("span", { class: "badge kind" }, "Imported from a local file")
            : "Curated from published sources",
      ],
      ...(s.imported
        ? ([["Status", s.enabled === false ? "Disabled" : "Enabled"]] as Array<[string, string]>)
        : []),
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
    s.imported ? importedControls(s, apply) : null,
  );
}

function resultView(result: ImportResult): HTMLElement {
  const list = (title: string, items: string[]) =>
    items.length === 0
      ? null
      : [
          h("h4", null, title),
          h(
            "ul",
            { class: "bullets" },
            items.map((i) => h("li", null, i)),
          ),
        ];
  return h(
    "div",
    { class: "import-result", role: "status" },
    h("p", null, h("strong", null, importSummary(result))),
    result.ok && result.setId !== undefined
      ? kv([
          ["Set ID", h("code", null, result.setId)],
          ["Indicators", String(result.indicatorCount ?? 0)],
        ])
      : null,
    list(`Errors (${result.errors.length})`, result.errors),
    list(`Warnings (${result.warnings.length})`, result.warnings),
  );
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The file could not be read as text."));
    };
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsText(file);
  });
}

function importCard(onImported: (status?: MonitoringStatus) => Promise<void>): HTMLElement {
  const fileId = uid("imp-file");
  const fmtName = uid("imp-format");
  const enableId = uid("imp-enable");
  const file = h("input", { type: "file", id: fileId, accept: ".json,application/json" });
  const radio = (value: "adtripwire" | "stix", label: string, checked: boolean) =>
    h(
      "label",
      { class: "radio" },
      h("input", { type: "radio", name: fmtName, value, checked }),
      label,
    );
  const adt = radio("adtripwire", "AdTripwire JSON", true);
  const stix = radio("stix", "STIX 2.1 bundle", false);
  const enable = h("input", { type: "checkbox", id: enableId, checked: true });
  const status = h("p", { class: "muted", role: "status" });
  const result = h("div", { class: "import-output" });
  const selectedFormat = (): "adtripwire" | "stix" =>
    stix.querySelector("input")?.checked ? "stix" : "adtripwire";

  const button = h(
    "button",
    {
      type: "button",
      class: "btn btn-primary",
      onclick: () => {
        const chosen = file.files?.[0] ?? null;
        const problem = checkImportFile(chosen);
        replaceChildren(result);
        if (problem !== null || chosen === null) {
          status.textContent = problem ?? "Choose a .json file to import.";
          return;
        }
        button.disabled = true;
        status.textContent = "Importing…";
        void (async () => {
          try {
            const text = await readFileText(chosen);
            const res = await rpc<ImportResult>({
              type: "import_indicator_set",
              format: selectedFormat(),
              text,
              enabled: enable.checked,
            });
            if (!isImportResult(res))
              throw new Error("The background returned an unexpected result.");
            status.textContent = "";
            replaceChildren(result, resultView(res));
            if (res.ok) {
              file.value = "";
              await onImported();
            }
          } catch (err) {
            status.textContent = `Import failed: ${errorMessage(err)}`;
          } finally {
            button.disabled = false;
          }
        })();
      },
    },
    "Import",
  );

  return card(
    "Import indicator set",
    h("p", null, IMPORT_NOTICE),
    h("div", { class: "field" }, h("label", { for: fileId }, "Indicator file (.json)"), file),
    h(
      "fieldset",
      { class: "field" },
      h("legend", null, "Format"),
      h("div", { class: "radio-row" }, adt, stix),
    ),
    h(
      "div",
      { class: "field field-check" },
      h("label", { for: enableId }, enable, "Enable immediately"),
    ),
    h("div", { class: "button-row" }, button),
    status,
    result,
  );
}

export const renderIndicators: View = async () => {
  const initial = await rpc<MonitoringStatus>({ type: "get_status" });
  const list = h("div", { class: "indicator-sets" });
  const banner = h("div");

  const render = (status: MonitoringStatus): void => {
    const sets = status.indicatorSets;
    const synthetic = sets.filter((s) => s.synthetic);
    replaceChildren(
      banner,
      synthetic.length > 0
        ? h(
            "div",
            { class: "banner banner-warn", role: "alert" },
            h("strong", null, "Synthetic indicator set loaded. "),
            `${synthetic.map((s) => s.name).join(", ")} contain${synthetic.length === 1 ? "s" : ""} test data, not real indicators. Observations matched against it do not reflect any documented infrastructure.`,
          )
        : null,
    );
    replaceChildren(
      list,
      sets.length === 0
        ? h("p", null, "No indicator sets are loaded. Known-infrastructure rules cannot match.")
        : sets.map((s) => setCard(s, render)),
    );
  };
  render(initial);

  const refresh = async (): Promise<void> => {
    render(await rpc<MonitoringStatus>({ type: "get_status" }));
  };

  return h(
    "div",
    { class: "view" },
    h("h2", null, "Indicators"),
    banner,
    h(
      "p",
      { class: "muted" },
      "Indicator updates: bundled with the extension, or imported from a local file below; the extension never fetches indicators.",
    ),
    list,
    importCard(refresh),
  );
};
