import type { ExportFile, UiRequest } from "@adtripwire/shared";
import { downloadText, errorMessage, h } from "../dom.js";
import { isExportFile, safeFilename } from "../exports.js";
import { rpc } from "../rpc.js";
import { profileSelect, uid } from "./common.js";

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
          status.textContent = "Preparing export…";
          void (async () => {
            try {
              status.textContent = await run();
            } catch (err) {
              status.textContent = `Export failed: ${errorMessage(err)}`;
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
    if (!isExportFile(file)) throw new Error("The background returned an unexpected export.");
    downloadText(safeFilename(file.filename, fallbackName), file.text, file.mediaType);
    return `Downloaded ${safeFilename(file.filename, fallbackName)}.`;
  };

  const handoffId = uid("handoff-help");
  const evidence = action("Evidence JSON (default / strict)", async () => {
    const p = profile.value();
    const data = await rpc<unknown>({ type: "export_evidence", profile: p, ...scope });
    const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    downloadText(opts.evidenceFilename(p), text);
    return "Export downloaded.";
  });
  const stix = action("STIX 2.1 bundle", () =>
    saveFile({ type: "export_stix", ...scope, includeIndicators: true }, "adtripwire-stix.json"),
  );
  const siem = action("SIEM NDJSON (ECS)", () =>
    saveFile({ type: "export_siem", ...scope }, "adtripwire-siem.ndjson"),
  );
  const handoff = action(
    "Hand-off package",
    () =>
      saveFile(
        { type: "export_handoff", ...scope, profile: profile.value() },
        "adtripwire-handoff.json",
      ),
    handoffId,
  );

  return h(
    "div",
    { class: "export-controls", role: "group", "aria-label": "Export" },
    profile.el,
    h("div", { class: "button-row" }, evidence, stix, siem, handoff),
    h("p", { id: handoffId, class: "muted small" }, HANDOFF_EXPLANATION),
    status,
  );
}
