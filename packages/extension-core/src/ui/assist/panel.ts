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
import { t } from "../i18n.js";
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
  return card(t("Local model assistance"), h("p", { class: "muted" }, t(NOT_INCLUDED_TEXT)));
}

export function renderScreened(out: ScreenedAssistOutput): HTMLElement {
  const paragraphs = out.text
    .split(/\n{2,}|\n(?=[A-ZÆØÅ][^\n]{0,60}\n)/)
    .filter((p) => p.trim().length > 0);
  return h(
    "div",
    { class: "assist-output", role: "region", "aria-label": t("Model interpretation") },
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
              t(FLAG_TEXT[f]),
            ),
          ),
        )
      : h("p", { class: "muted small" }, t("Screening found nothing to remove or mask.")),
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
      t("Local model assistance"),
      h(
        "p",
        { class: "muted" },
        t(
          "Off. Enable it under Settings to let a local model runtime on this computer explain this evidence. Nothing leaves the device.",
        ),
      ),
      h("a", { href: "#settings" }, t("Open settings")),
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
        status.textContent = t("Building the exact text that would be sent…");
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
                    t(
                      "What would be sent ({n} characters, hostnames and rule text only; no notes)",
                      { n: p.user.length + p.system.length },
                    ),
                  ),
                  h("h4", { id }, t("System instructions")),
                  h("pre", { class: "prompt-text", "aria-labelledby": id }, p.system),
                  h("h4", null, t("Evidence")),
                  h("pre", { class: "prompt-text" }, p.user),
                ),
              );
            },
            (err: unknown) => {
              status.textContent = t("Could not build the package: {error}", {
                error: errorMessage(err),
              });
            },
          )
          .finally(() => {
            previewBtn.disabled = false;
          });
      },
    },
    t("Preview what would be sent"),
  );

  const askBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-primary",
      disabled: a.model === "",
      onclick: () => {
        askBtn.disabled = true;
        status.textContent = t(
          "Asking {model} on 127.0.0.1:{port}… this can take a minute on a small machine.",
          { model: a.model, port: a.port },
        );
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
            status.textContent = t(
              "Answer received and screened ({removed} sentence(s) removed, {masked} hostname(s) masked).",
              { removed: screened.removedSentences, masked: screened.maskedHostnames },
            );
          } catch (err) {
            status.textContent = t("The local model could not be used: {error}", {
              error: errorMessage(err),
            });
          } finally {
            askBtn.disabled = false;
          }
        })();
      },
    },
    t("Ask local model to explain"),
  );

  return card(
    t("Local model assistance"),
    h(
      "p",
      { class: "muted small" },
      t(
        "Sends sanitized hostnames, path patterns and rule text to {model} on this computer. The answer is interpretation: it is screened, labelled and never stored.",
        { model: a.model || t("(no model chosen)") },
      ),
    ),
    h("div", { class: "button-row" }, previewBtn, askBtn),
    status,
    preview,
    output,
  );
}
