import type { ExportFile, UiRequest } from "@adtripwire/shared";
import { downloadText, errorMessage, h } from "../dom.js";
import { isExportFile, safeFilename } from "../exports.js";
import { t } from "../i18n.js";
import { rpc } from "../rpc.js";
import { profileSelect, uid } from "./common.js";
import { shareSheet } from "./share-sheet.js";

export const HANDOFF_EXPLANATION =
  "A hand-off package is a single JSON file with the evidence, a STIX bundle, your notes and a plain-language README for a helpline or analyst.";

/**
 * Export button group shared by the detection detail view (one detection) and Settings (all
 * detections, `detectionIds` omitted). Evidence JSON keeps its original saving behaviour; the
 * other formats are saved from the `ExportFile` the background returns.
 */
export function exportGroup(opts: {
  detectionIds?: string[];
  evidenceFilename: (profile: "default" | "strict") => string;
}): HTMLElement {
  const profile = profileSelect();
  const statusId = uid("export-status");
  const status = h("p", { id: statusId, class: "muted", role: "status" });
  const buttons: HTMLButtonElement[] = [];
  const scope = opts.detectionIds ? { detectionIds: opts.detectionIds } : {};

  const action = (label: string, run: () => Promise<string>, describedBy?: string) => {
    const button = h(
      "button",
      {
        type: "button",
        class: "btn",
        "aria-describedby": describedBy ? `${describedBy} ${statusId}` : statusId,
        onclick: () => {
          for (const b of buttons) b.disabled = true;
          status.textContent = t("Preparing export…");
          void (async () => {
            try {
              status.textContent = await run();
            } catch (err) {
              status.textContent = t("Export failed: {error}", { error: errorMessage(err) });
            } finally {
              for (const b of buttons) b.disabled = false;
            }
          })();
        },
      },
      label,
    );
    buttons.push(button);
    return button;
  };

  const saveFile = async (req: UiRequest, fallbackName: string): Promise<string> => {
    const file = await rpc<ExportFile>(req);
    if (!isExportFile(file)) throw new Error(t("The background returned an unexpected export."));
    downloadText(safeFilename(file.filename, fallbackName), file.text, file.mediaType);
    return t("Downloaded {filename}.", {
      filename: safeFilename(file.filename, fallbackName),
    });
  };

  const evidence = action(t("Evidence JSON (default / strict)"), async () => {
    const p = profile.value();
    const data = await rpc<unknown>({ type: "export_evidence", profile: p, ...scope });
    // The background answers { filename, json } where json is the serialised export; save the
    // export itself, never the wrapper.
    const json =
      data !== null &&
      typeof data === "object" &&
      typeof (data as { json?: unknown }).json === "string"
        ? (data as { json: string }).json
        : null;
    if (json === null) throw new Error(t("The background returned an unexpected export."));
    downloadText(opts.evidenceFilename(p), json);
    return t("Export downloaded.");
  });
  const stix = action(t("STIX 2.1 bundle"), () =>
    saveFile({ type: "export_stix", ...scope, includeIndicators: true }, "adtripwire-stix.json"),
  );
  const siem = action(t("SIEM NDJSON (ECS)"), () =>
    saveFile({ type: "export_siem", ...scope }, "adtripwire-siem.ndjson"),
  );
  return h(
    "div",
    { class: "export-controls", role: "group", "aria-label": t("Export") },
    profile.el,
    h("div", { class: "button-row" }, evidence, stix, siem),
    h("p", { class: "muted small" }, t(HANDOFF_EXPLANATION)),
    shareSheet({ ...scope, initialProfile: profile.value() }),
    status,
  );
}
