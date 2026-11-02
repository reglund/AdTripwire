/**
 * Settings card for local-model assistance. In the default build it only explains that the
 * feature is not included; in an --assist build it offers an explicit opt-in with a
 * description of what is sent, a loopback port, model choice (probed from the runtime) and
 * answer language.
 */
import type { Settings } from "@adtripwire/shared";
import { OllamaProvider } from "@adtripwire/correlation";
import { errorMessage, h } from "../dom.js";
import { parseBoundedInt } from "../format.js";
import { t } from "../i18n.js";
import { rpc } from "../rpc.js";
import { card, uid, type ViewContext } from "../views/common.js";
import { NOT_INCLUDED_TEXT } from "./panel.js";

export function assistSettingsCard(settings: Settings, ctx: ViewContext): HTMLElement {
  // Keep the assist-only call inside the constant branch so the default build tree-shakes
  // the provider (and with it every network code path) out of the bundle.
  if (__ADTRIPWIRE_ASSIST__) return fullCard(settings, ctx);
  return card(
    t("Local model assistance (optional)"),
    h("p", { class: "muted" }, t(NOT_INCLUDED_TEXT)),
  );
}

function fullCard(settings: Settings, ctx: ViewContext): HTMLElement {
  const a = settings.assist;
  const status = h("p", { class: "muted", role: "status" });

  const enabledId = uid("assist");
  const enabled = h("input", {
    type: "checkbox",
    id: enabledId,
    checked: a.enabled,
    "aria-describedby": `${enabledId}-h`,
  });
  const portId = uid("port");
  const port = h("input", {
    type: "text",
    inputmode: "numeric",
    id: portId,
    value: String(a.port),
    "aria-describedby": `${portId}-h`,
  });
  const langId = uid("lang");
  const lang = h(
    "select",
    { id: langId },
    h("option", { value: "en", selected: a.language === "en" }, "English"),
    h("option", { value: "nb", selected: a.language === "nb" }, "Norsk bokmål"),
  );
  const modelId = uid("model");
  const model = h("select", { id: modelId, "aria-describedby": `${modelId}-h` });
  const fillModels = (names: string[]): void => {
    model.replaceChildren(
      h(
        "option",
        { value: "" },
        names.length === 0 ? t("(no models found)") : t("(choose a model)"),
      ),
      ...names.map((n) => h("option", { value: n, selected: n === a.model }, n)),
    );
    if (a.model && !names.includes(a.model)) {
      model.appendChild(
        h(
          "option",
          { value: a.model, selected: true },
          t("{model} (not currently listed)", { model: a.model }),
        ),
      );
    }
  };
  fillModels(a.model ? [a.model] : []);

  const probeBtn = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        const p = parseBoundedInt(port.value, 1, 65535);
        if (p === null) {
          status.textContent = t("Enter a port between 1 and 65535.");
          return;
        }
        probeBtn.disabled = true;
        status.textContent = t("Checking 127.0.0.1:{port}…", { port: p });
        void new OllamaProvider({
          baseUrl: `http://127.0.0.1:${p}`,
          model: "",
          fetchImpl: (url, init) => fetch(url, init),
          timeoutMs: 8000,
        })
          .probe()
          .then((r) => {
            if (r.ok) {
              fillModels(r.models);
              status.textContent = t("Runtime reachable; {n} model(s) listed.", {
                n: r.models.length,
              });
            } else {
              status.textContent = t(
                "No runtime answered on 127.0.0.1:{port} ({error}). Start Ollama or check the port.",
                { port: p, error: r.error ?? t("unknown error") },
              );
            }
          })
          .finally(() => {
            probeBtn.disabled = false;
          });
      },
    },
    t("Check runtime and list models"),
  );

  const saveBtn = h(
    "button",
    {
      type: "button",
      class: "btn btn-primary",
      onclick: () => {
        const p = parseBoundedInt(port.value, 1, 65535);
        if (p === null) {
          status.textContent = t("Enter a port between 1 and 65535. Nothing was saved.");
          return;
        }
        saveBtn.disabled = true;
        status.textContent = t("Saving…");
        void rpc<Settings>({
          type: "update_assist_settings",
          patch: {
            enabled: enabled.checked,
            port: p,
            model: model.value,
            language: lang.value === "nb" ? "nb" : "en",
          },
        })
          .then(
            () => {
              status.textContent = t("Saved.");
              ctx.reload();
            },
            (err: unknown) => {
              status.textContent = t("Saving failed: {error}", { error: errorMessage(err) });
            },
          )
          .finally(() => {
            saveBtn.disabled = false;
          });
      },
    },
    t("Save assistance settings"),
  );

  return card(
    t("Local model assistance (optional)"),
    h(
      "div",
      { class: "notice-warn" },
      h("h4", null, t("What this does")),
      h(
        "ul",
        { class: "bullets" },
        [
          "Sends sanitized hostnames, path patterns, rule names and rule text for one detection or group to a model runtime on this computer (127.0.0.1 only), when you press the button.",
          "Never sends analyst notes, cookie values, full URLs or page content; you can preview the exact text first.",
          "The answer is interpretation: it is screened for claims about infection or safety and for hostnames not in the evidence, labelled, and never stored or exported.",
          "The model cannot change a detection, its priority or the evidence.",
        ].map((text) => h("li", null, t(text))),
      ),
    ),
    h(
      "div",
      { class: "field field-check" },
      h("label", { for: enabledId }, enabled, t("Enable local model assistance")),
      h(
        "p",
        { id: `${enabledId}-h`, class: "muted small" },
        t("Off by default. Requires an Ollama-compatible runtime listening on this computer."),
      ),
    ),
    h(
      "div",
      { class: "field" },
      h("label", { for: portId }, t("Runtime port on 127.0.0.1")),
      port,
      h(
        "p",
        { id: `${portId}-h`, class: "muted small" },
        t("Ollama's default is 11434. Only loopback is ever contacted."),
      ),
    ),
    h(
      "div",
      { class: "field" },
      h("label", { for: modelId }, t("Model")),
      model,
      h(
        "p",
        { id: `${modelId}-h`, class: "muted small" },
        t("Press the check button to list models the runtime has available."),
      ),
    ),
    h("div", { class: "field" }, h("label", { for: langId }, t("Answer language")), lang),
    h("div", { class: "button-row" }, probeBtn, saveBtn),
    status,
  );
}
