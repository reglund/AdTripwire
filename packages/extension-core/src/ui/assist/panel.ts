/**
 * Local-model assistance panel. Present only in builds made with `--assist`; the default
 * build renders a one-paragraph explanation instead and contains no network code path.
 *
 * Flow: fetch the exact package from the background (so the person can read what would be
 * sent) → send it to the loopback runtime → screen the answer → display it labelled as
 * interpretation. Nothing is persisted; the answer lives in this page only.
 */
import type {
  AssistPackage,
  GuardrailFlag,
  ScreenedAssistOutput,
  Settings,
} from "@adtripwire/shared";
import { ASSIST_LABEL, OllamaProvider, screenAssistOutput } from "@adtripwire/correlation";
import { errorMessage, h } from "../dom.js";
import { rpc } from "../rpc.js";
import { card, uid } from "../views/common.js";

export type AssistTarget = { detectionId: string } | { clusterId: string };

export const FLAG_TEXT: Record<GuardrailFlag, string> = {
  asserted_compromise:
    "The model asserted that the device or person is compromised; that sentence was removed.",
  asserted_safety:
    "The model asserted that the device or person is safe; that sentence was removed.",
  hedged_claim:
    "A sentence mentions infection or safety only as something the evidence cannot show; it was kept.",
  unknown_hostname:
    "The model named a hostname or address that is not in the evidence; it was masked.",
  severity_language: "The model used priority language stronger than the detections carry.",
  instruction_echo: "The output echoed instruction-like text; treat it with extra care.",
  contains_url: "The output contained a link; it is shown as plain text only.",
  truncated: "The output was longer than the display limit and was cut.",
};

export const NOT_INCLUDED_TEXT =
  "Not included in this build. The standard AdTripwire build has no network capability at all. A separate build made with the --assist flag can talk to a local model runtime on this computer (loopback only) to explain detections; see docs/local-assist.md.";

export function assistPanel(target: AssistTarget, settings: Settings): HTMLElement {
  if (__ADTRIPWIRE_ASSIST__) return fullPanel(target, settings);
  return card("Local model assistance", h("p", { class: "muted" }, NOT_INCLUDED_TEXT));
}

export function renderScreened(out: ScreenedAssistOutput): HTMLElement {
  const paragraphs = out.text
    .split(/\n{2,}|\n(?=[A-ZÆØÅ][^\n]{0,60}\n)/)
    .filter((p) => p.trim().length > 0);
  return h(
    "div",
    { class: "assist-output", role: "region", "aria-label": "Model interpretation" },
    h("p", { class: "assist-label" }, ASSIST_LABEL),
    out.flags.length > 0
      ? h(
          "ul",
          { class: "assist-flags" },
          out.flags.map((f) =>
            h(
              "li",
              null,
              h("span", { class: "badge badge-warn" }, f.replace(/_/g, " ")),
              " ",
              FLAG_TEXT[f],
            ),
          ),
        )
      : h("p", { class: "muted small" }, "Screening found nothing to remove or mask."),
    ...paragraphs.map((p) => {
      const lines = p.split("\n");
      return h(
        "p",
        { class: "assist-text" },
        lines.flatMap((l, i) => (i === 0 ? [l] : [h("br"), l])),
      );
    }),
  );
}

function fullPanel(target: AssistTarget, settings: Settings): HTMLElement {
  const a = settings.assist;
  if (!a.enabled) {
    return card(
      "Local model assistance",
      h(
        "p",
        { class: "muted" },
        "Off. Enable it under Settings to let a local model runtime on this computer explain this evidence. Nothing leaves the device.",
      ),
      h("a", { href: "#settings" }, "Open settings"),
    );
  }
  const status = h("p", { class: "muted", role: "status" });
  const preview = h("div");
  const output = h("div");
  let pkg: AssistPackage | null = null;

  const load = async (): Promise<AssistPackage> => {
    if (pkg) return pkg;
    pkg = await rpc<AssistPackage>({ type: "get_assist_package", ...target, language: a.language });
    return pkg;
  };

  const previewBtn = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        previewBtn.disabled = true;
        status.textContent = "Building the exact text that would be sent…";
        void load()
          .then(
            (p) => {
              status.textContent = "";
              const id = uid("prompt");
              preview.replaceChildren(
                h(
                  "details",
                  { class: "prompt-preview" },
                  h(
                    "summary",
                    null,
                    `What would be sent (${p.user.length + p.system.length} characters, hostnames and rule text only; no notes)`,
                  ),
                  h("h4", { id }, "System instructions"),
                  h("pre", { class: "prompt-text", "aria-labelledby": id }, p.system),
                  h("h4", null, "Evidence"),
                  h("pre", { class: "prompt-text" }, p.user),
                ),
              );
            },
            (err: unknown) => {
              status.textContent = `Could not build the package: ${errorMessage(err)}`;
            },
          )
          .finally(() => {
            previewBtn.disabled = false;
          });
      },
    },
    "Preview what would be sent",
  );

  const askBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-primary",
      disabled: a.model === "",
      onclick: () => {
        askBtn.disabled = true;
        status.textContent = `Asking ${a.model} on 127.0.0.1:${a.port}… this can take a minute on a small machine.`;
        void (async () => {
          try {
            const p = await load();
            const provider = new OllamaProvider({
              baseUrl: `http://127.0.0.1:${a.port}`,
              model: a.model,
              fetchImpl: (url, init) => fetch(url, init),
            });
            const raw = await provider.complete(p);
            const screened = screenAssistOutput(raw, p.context);
            output.replaceChildren(renderScreened(screened));
            status.textContent = `Answer received and screened (${screened.removedSentences} sentence(s) removed, ${screened.maskedHostnames} hostname(s) masked).`;
          } catch (err) {
            status.textContent = `The local model could not be used: ${errorMessage(err)}`;
          } finally {
            askBtn.disabled = false;
          }
        })();
      },
    },
    "Ask local model to explain",
  );

  return card(
    "Local model assistance",
    h(
      "p",
      { class: "muted small" },
      `Sends sanitized hostnames, path patterns and rule text to ${a.model || "(no model chosen)"} on this computer. The answer is interpretation: it is screened, labelled and never stored.`,
    ),
    h("div", { class: "button-row" }, previewBtn, askBtn),
    status,
    preview,
    output,
  );
}
