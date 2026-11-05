import type { MonitoringStatus, Settings, UiRequest } from "@adtripwire/shared";
import { errorMessage, h } from "../dom.js";
import { minutesToMs, msToMinutes, parseBoundedInt } from "../format.js";
import { applyLanguageSetting, t } from "../i18n.js";
import { requestHostPermission, rpc } from "../rpc.js";
import { card, uid, type View, type ViewContext } from "./common.js";
import { exportGroup } from "./export-actions.js";
import { assistSettingsCard } from "../assist/settings-card.js";

const LIMITS = {
  maxBytes: { min: 1024, max: 16 * 1024 * 1024 },
  windowMinutes: { min: 1, max: 1440 },
  retentionDays: { min: 1, max: 365 },
  maxDetections: { min: 10, max: 100_000 },
} as const;

type Patch = Extract<UiRequest, { type: "update_settings" }>["patch"];

function checkbox(label: string, help: string, checked: boolean) {
  const id = uid("chk");
  const input = h("input", { type: "checkbox", id, "aria-describedby": `${id}-h`, checked });
  return {
    input,
    el: h(
      "div",
      { class: "field field-check" },
      h("label", { for: id }, input, label),
      h("p", { id: `${id}-h`, class: "muted small" }, help),
    ),
  };
}

function numberField(label: string, help: string, value: number, unit: string) {
  const id = uid("num");
  const input = h("input", {
    type: "text",
    inputmode: "numeric",
    id,
    value: String(value),
    "aria-describedby": `${id}-h ${id}-e`,
  });
  const error = h("p", { id: `${id}-e`, class: "field-error", role: "alert" });
  return {
    input,
    error,
    el: h(
      "div",
      { class: "field" },
      h("label", { for: id }, `${label} (${unit})`),
      input,
      h("p", { id: `${id}-h`, class: "muted small" }, help),
      error,
    ),
  };
}

function exportAll(): HTMLElement {
  return exportGroup({
    evidenceFilename: (p) =>
      `adtripwire-evidence-${p}-${new Date().toISOString().slice(0, 10)}.json`,
  });
}

function deleteControls(): HTMLElement {
  const status = h("p", { class: "muted", role: "status" });
  const wrap = h("div", { class: "delete-controls" });

  const showInitial = (): void => {
    const start = h(
      "button",
      { type: "button", class: "btn btn-danger", onclick: showConfirm },
      t("Delete all collected data"),
    );
    wrap.replaceChildren(start, status);
  };

  function showConfirm(): void {
    status.textContent = "";
    const cancel = h("button", { type: "button", class: "btn", onclick: showInitial }, t("Cancel"));
    const confirm = h(
      "button",
      {
        type: "button",
        class: "btn btn-danger",
        onclick: () => {
          confirm.disabled = true;
          cancel.disabled = true;
          void (async () => {
            try {
              await rpc<unknown>({ type: "delete_all_data" });
              showInitial();
              status.textContent = t("All collected data was deleted.");
            } catch (err) {
              showInitial();
              status.textContent = t("Deletion failed: {error}", { error: errorMessage(err) });
            }
          })();
        },
      },
      t("Confirm deletion"),
    );
    wrap.replaceChildren(
      h(
        "p",
        { role: "alert" },
        t("This permanently deletes all stored detections and events. This cannot be undone."),
      ),
      h("div", { class: "button-row" }, confirm, cancel),
      status,
    );
    cancel.focus();
  }

  showInitial();
  return wrap;
}

function pageSensorControls(initial: boolean): HTMLElement {
  const id = uid("psensor");
  let enabled = initial;
  const wrap = h("div", { class: "page-sensor" });
  const status = h("p", { class: "muted", role: "status" });

  const refocus = (): void => document.getElementById(id)?.focus();

  const save = async (value: boolean): Promise<void> => {
    status.textContent = t("Saving…");
    try {
      await rpc<unknown>({ type: "update_settings", patch: { pageSensorEnabled: value } });
      enabled = value;
      render();
      refocus();
      status.textContent = value ? t("Page sensor enabled.") : t("Page sensor disabled.");
    } catch (err) {
      render();
      refocus();
      status.textContent = t("Saving failed: {error}", { error: errorMessage(err) });
    }
  };

  const explanation = (): HTMLElement =>
    h(
      "div",
      { class: "notice-warn", id: `${id}-consent`, role: "group", "aria-labelledby": `${id}-ch` },
      h("h4", { id: `${id}-ch` }, t("Before you enable the page sensor")),
      h("p", null, h("strong", null, t("What it does"))),
      h(
        "ul",
        { class: "bullets" },
        [
          "An isolated content script runs only inside embedded sub-frames (iframes).",
          "It reports structural facts: a hidden iframe inserted after load, a third-party script or image inserted late, and one documented SDK postMessage type.",
        ].map((text) => h("li", null, t(text))),
      ),
      h("p", null, h("strong", null, t("What it never does"))),
      h(
        "ul",
        { class: "bullets" },
        [
          "It never reads page text or form values.",
          "It never reads cookies.",
          "It records no URLs beyond hostnames.",
          "It never runs in top-level documents.",
          "It never runs in private windows.",
        ].map((text) => h("li", null, t(text))),
      ),
      h(
        "p",
        null,
        t(
          "You can turn it off at any time with one click. See Threat model → Page sensor in the project documentation.",
        ),
      ),
    );

  function render(): void {
    const toggle = h("input", {
      type: "checkbox",
      id,
      "aria-describedby": `${id}-h`,
      checked: enabled,
      onchange: () => {
        if (toggle.checked) {
          // Enabling needs an explicit second click on the consent panel.
          toggle.checked = false;
          showConsent();
        } else {
          toggle.disabled = true;
          void save(false);
        }
      },
    });
    wrap.replaceChildren(
      h(
        "div",
        { class: "field field-check" },
        h("label", { for: id }, toggle, t("Page sensor enabled")),
        h(
          "p",
          { id: `${id}-h`, class: "muted small" },
          t(
            "Optional and off by default. Changes apply immediately; no need to press Save settings.",
          ),
        ),
      ),
      status,
    );
  }

  function showConsent(): void {
    status.textContent = "";
    const cancel = h(
      "button",
      {
        type: "button",
        class: "btn",
        onclick: () => {
          render();
          refocus();
        },
      },
      t("Cancel"),
    );
    const confirm = h(
      "button",
      {
        type: "button",
        class: "btn btn-primary",
        onclick: () => {
          confirm.disabled = true;
          cancel.disabled = true;
          void save(true);
        },
      },
      t("Enable page sensor"),
    );
    wrap.replaceChildren(explanation(), h("div", { class: "button-row" }, confirm, cancel), status);
    confirm.focus();
  }

  render();
  return wrap;
}

function languageCard(ctx: ViewContext, current: Settings["ui"]["language"]): HTMLElement {
  const id = uid("ui-lang");
  const select = h(
    "select",
    {
      id,
      "aria-describedby": `${id}-h`,
      onchange: () => {
        const value = select.value;
        const language = value === "en" || value === "nb" ? value : "auto";
        select.disabled = true;
        void rpc<Settings>({ type: "update_ui_settings", patch: { language } }).then(
          (next) => {
            applyLanguageSetting(next);
            ctx.reload();
          },
          (err: unknown) => {
            select.disabled = false;
            status.textContent = t("Saving failed: {error}", { error: errorMessage(err) });
          },
        );
      },
    },
    h("option", { value: "auto", selected: current === "auto" }, t("Auto (follow browser)")),
    h("option", { value: "en", selected: current === "en" }, "English"),
    h("option", { value: "nb", selected: current === "nb" }, "Norsk bokmål"),
  );
  const status = h("p", { class: "muted", role: "status" });
  return card(
    t("Language"),
    h(
      "div",
      { class: "field" },
      h("label", { for: id }, t("Interface language")),
      select,
      h(
        "p",
        { id: `${id}-h`, class: "muted small" },
        t(
          "Applies to the interface only. Detection text from the rules stays in English in this version.",
        ),
      ),
    ),
    status,
  );
}

export const renderSettings: View = async (ctx) => {
  const [settings, status] = await Promise.all([
    rpc<Settings>({ type: "get_settings" }),
    rpc<MonitoringStatus>({ type: "get_status" }),
  ]);
  const m = settings.monitoring;
  const r = settings.retention;

  const enabled = checkbox(
    t("Monitoring enabled"),
    t("Observe network request metadata in this browser."),
    m.enabled,
  );
  const inspect = checkbox(
    t("Response inspection enabled"),
    t(
      "Analyse a bounded prefix of selected script responses for technique markers. Only marker names are stored, never script text.",
    ),
    m.responseInspectionEnabled,
  );
  const incognito = checkbox(
    t("Exclude private windows"),
    t("Do not observe requests from private browsing windows."),
    m.excludeIncognito,
  );
  const maxBytes = numberField(
    t("Response inspection maximum size"),
    t("Bytes analysed per response ({min}–{max}).", LIMITS.maxBytes),
    m.responseInspectionMaxBytes,
    t("bytes"),
  );
  const windowMin = numberField(
    t("Correlation window"),
    t("Time span within which events can be correlated ({min}–{max}).", LIMITS.windowMinutes),
    msToMinutes(m.correlationWindowMs),
    t("minutes"),
  );
  const days = numberField(
    t("Retention"),
    t("How long detections and their events are kept ({min}–{max}).", LIMITS.retentionDays),
    r.detectionRetentionDays,
    t("days"),
  );
  const maxDet = numberField(
    t("Maximum detections"),
    t("Oldest detections are removed beyond this number ({min}–{max}).", LIMITS.maxDetections),
    r.maxDetections,
    t("detections"),
  );

  const saveStatus = h("p", { class: "muted", role: "status" });
  const form = h(
    "form",
    {
      class: "settings-form",
      novalidate: true,
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        const fields = [
          [maxBytes, LIMITS.maxBytes],
          [windowMin, LIMITS.windowMinutes],
          [days, LIMITS.retentionDays],
          [maxDet, LIMITS.maxDetections],
        ] as const;
        let firstInvalid: HTMLInputElement | null = null;
        const values: number[] = [];
        for (const [f, lim] of fields) {
          const v = parseBoundedInt(f.input.value, lim.min, lim.max);
          f.error.textContent =
            v === null ? t("Enter a whole number from {min} to {max}.", lim) : "";
          f.input.setAttribute("aria-invalid", v === null ? "true" : "false");
          if (v === null) firstInvalid ??= f.input;
          else values.push(v);
        }
        if (firstInvalid) {
          saveStatus.textContent = t("Some values are invalid. Nothing was saved.");
          firstInvalid.focus();
          return;
        }
        const [bytes, minutes, retentionDays, maxDetections] = values as [
          number,
          number,
          number,
          number,
        ];
        const patch: Patch = {
          enabled: enabled.input.checked,
          responseInspectionEnabled: inspect.input.checked,
          responseInspectionMaxBytes: bytes,
          excludeIncognito: incognito.input.checked,
          correlationWindowMs: minutesToMs(minutes),
          detectionRetentionDays: retentionDays,
          maxDetections,
        };
        saveStatus.textContent = t("Saving…");
        void rpc<unknown>({ type: "update_settings", patch }).then(
          () => {
            saveStatus.textContent = t("Settings saved.");
          },
          (err: unknown) => {
            saveStatus.textContent = t("Saving failed: {error}", { error: errorMessage(err) });
          },
        );
      },
    },
    enabled.el,
    inspect.el,
    maxBytes.el,
    incognito.el,
    windowMin.el,
    days.el,
    maxDet.el,
    h(
      "p",
      { class: "muted small" },
      t(
        "The daily calendar keeps counts and documented hostnames for 400 days regardless of this setting; deleting all data removes them.",
      ),
    ),
    h("button", { type: "submit", class: "btn btn-primary" }, t("Save settings")),
    saveStatus,
  );

  const permission = status.hostPermissionGranted
    ? h("p", null, t("Monitoring permission: granted."))
    : h(
        "div",
        null,
        h(
          "p",
          { class: "notice-warn" },
          t("Monitoring permission: not granted. Nothing is observed until it is."),
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-primary",
            onclick: () => {
              void requestHostPermission().then(
                () => ctx.reload(),
                () => ctx.reload(),
              );
            },
          },
          t("Grant monitoring permission"),
        ),
      );

  return h(
    "div",
    { class: "view" },
    h("h2", null, t("Settings")),
    card(t("Permission"), permission),
    card(t("Monitoring and retention"), form),
    card(
      t("Optional page sensor"),
      h(
        "p",
        null,
        t(
          "An opt-in sensor for structural signals inside embedded sub-frames. Network monitoring works without it.",
        ),
      ),
      pageSensorControls(m.pageSensorEnabled),
    ),
    languageCard(ctx, settings.ui.language),
    card(
      t("Export"),
      h(
        "p",
        null,
        t(
          "Export all detections and their supporting sanitized events for analysis or sharing with an incident-response contact: evidence JSON, a STIX 2.1 bundle, SIEM NDJSON (ECS) or a hand-off package.",
        ),
      ),
      exportAll(),
    ),
    assistSettingsCard(settings, ctx),
    card(t("Delete data"), deleteControls()),
    card(
      t("Privacy summary"),
      h(
        "p",
        null,
        __ADTRIPWIRE_ASSIST__
          ? t(
              "Everything stays on this device. AdTripwire sends no telemetry. This build can contact a local model runtime on 127.0.0.1 only, and only when local model assistance is enabled and you press the button.",
            )
          : t(
              "Everything stays on this device. AdTripwire sends no telemetry and makes no network requests of its own.",
            ),
      ),
      h(
        "div",
        { class: "two-col" },
        h(
          "div",
          null,
          h("h4", null, t("Stored locally")),
          h(
            "ul",
            { class: "bullets" },
            [
              "Sanitized hostnames",
              "Path patterns with token-like segments replaced",
              "Query parameter names (not values)",
              "Request metadata such as resource type, status code, size and timing",
              "Detections and the rule that produced them",
            ].map((text) => h("li", null, t(text))),
          ),
        ),
        h(
          "div",
          null,
          h("h4", null, t("Never stored")),
          h(
            "ul",
            { class: "bullets" },
            [
              "Cookie values",
              "Full URLs with query values",
              "Page content or script source text",
              "Browsing history",
            ].map((text) => h("li", null, t(text))),
          ),
        ),
      ),
    ),
  );
};
