import type { MonitoringStatus, Settings, UiRequest } from "@adtripwire/shared";
import { downloadText, errorMessage, h } from "../dom.js";
import { minutesToMs, msToMinutes, parseBoundedInt } from "../format.js";
import { requestHostPermission, rpc } from "../rpc.js";
import { card, profileSelect, uid, type View } from "./common.js";

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
  const profile = profileSelect();
  const status = h("p", { class: "muted", role: "status" });
  const button = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        button.disabled = true;
        status.textContent = "Preparing export…";
        void (async () => {
          try {
            const p = profile.value();
            const data = await rpc<unknown>({ type: "export_evidence", profile: p });
            const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
            downloadText(
              `adtripwire-evidence-${p}-${new Date().toISOString().slice(0, 10)}.json`,
              text,
            );
            status.textContent = "Export downloaded.";
          } catch (err) {
            status.textContent = `Export failed: ${errorMessage(err)}`;
          } finally {
            button.disabled = false;
          }
        })();
      },
    },
    "Export all evidence (JSON)",
  );
  return h("div", { class: "export-controls" }, profile.el, button, status);
}

function deleteControls(): HTMLElement {
  const status = h("p", { class: "muted", role: "status" });
  const wrap = h("div", { class: "delete-controls" });

  const showInitial = (): void => {
    const start = h(
      "button",
      { type: "button", class: "btn btn-danger", onclick: showConfirm },
      "Delete all collected data",
    );
    wrap.replaceChildren(start, status);
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
          confirm.disabled = true;
          cancel.disabled = true;
          void (async () => {
            try {
              await rpc<unknown>({ type: "delete_all_data" });
              showInitial();
              status.textContent = "All collected data was deleted.";
            } catch (err) {
              showInitial();
              status.textContent = `Deletion failed: ${errorMessage(err)}`;
            }
          })();
        },
      },
      "Confirm deletion",
    );
    wrap.replaceChildren(
      h(
        "p",
        { role: "alert" },
        "This permanently deletes all stored detections and events. This cannot be undone.",
      ),
      h("div", { class: "button-row" }, confirm, cancel),
      status,
    );
    cancel.focus();
  }

  showInitial();
  return wrap;
}

export const renderSettings: View = async (ctx) => {
  const [settings, status] = await Promise.all([
    rpc<Settings>({ type: "get_settings" }),
    rpc<MonitoringStatus>({ type: "get_status" }),
  ]);
  const m = settings.monitoring;
  const r = settings.retention;

  const enabled = checkbox(
    "Monitoring enabled",
    "Observe network request metadata in this browser.",
    m.enabled,
  );
  const inspect = checkbox(
    "Response inspection enabled",
    "Analyse a bounded prefix of selected script responses for technique markers. Only marker names are stored, never script text.",
    m.responseInspectionEnabled,
  );
  const incognito = checkbox(
    "Exclude private windows",
    "Do not observe requests from private browsing windows.",
    m.excludeIncognito,
  );
  const maxBytes = numberField(
    "Response inspection maximum size",
    `Bytes analysed per response (${LIMITS.maxBytes.min}–${LIMITS.maxBytes.max}).`,
    m.responseInspectionMaxBytes,
    "bytes",
  );
  const windowMin = numberField(
    "Correlation window",
    `Time span within which events can be correlated (${LIMITS.windowMinutes.min}–${LIMITS.windowMinutes.max}).`,
    msToMinutes(m.correlationWindowMs),
    "minutes",
  );
  const days = numberField(
    "Retention",
    `How long detections and their events are kept (${LIMITS.retentionDays.min}–${LIMITS.retentionDays.max}).`,
    r.detectionRetentionDays,
    "days",
  );
  const maxDet = numberField(
    "Maximum detections",
    `Oldest detections are removed beyond this number (${LIMITS.maxDetections.min}–${LIMITS.maxDetections.max}).`,
    r.maxDetections,
    "detections",
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
            v === null ? `Enter a whole number from ${lim.min} to ${lim.max}.` : "";
          f.input.setAttribute("aria-invalid", v === null ? "true" : "false");
          if (v === null) firstInvalid ??= f.input;
          else values.push(v);
        }
        if (firstInvalid) {
          saveStatus.textContent = "Some values are invalid. Nothing was saved.";
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
        saveStatus.textContent = "Saving…";
        void rpc<unknown>({ type: "update_settings", patch }).then(
          () => {
            saveStatus.textContent = "Settings saved.";
          },
          (err: unknown) => {
            saveStatus.textContent = `Saving failed: ${errorMessage(err)}`;
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
    h("button", { type: "submit", class: "btn btn-primary" }, "Save settings"),
    saveStatus,
  );

  const permission = status.hostPermissionGranted
    ? h("p", null, "Monitoring permission: granted.")
    : h(
        "div",
        null,
        h(
          "p",
          { class: "notice-warn" },
          "Monitoring permission: not granted. Nothing is observed until it is.",
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
          "Grant monitoring permission",
        ),
      );

  return h(
    "div",
    { class: "view" },
    h("h2", null, "Settings"),
    card("Permission", permission),
    card("Monitoring and retention", form),
    card(
      "Export",
      h(
        "p",
        null,
        "Export detections and their supporting sanitized events as JSON for analysis or sharing with an incident-response contact.",
      ),
      exportAll(),
    ),
    card("Delete data", deleteControls()),
    card(
      "Privacy summary",
      h(
        "p",
        null,
        "Everything stays on this device. AdTripwire sends no telemetry and makes no network requests of its own.",
      ),
      h(
        "div",
        { class: "two-col" },
        h(
          "div",
          null,
          h("h4", null, "Stored locally"),
          h(
            "ul",
            { class: "bullets" },
            [
              "Sanitized hostnames",
              "Path patterns with token-like segments replaced",
              "Query parameter names (not values)",
              "Request metadata such as resource type, status code, size and timing",
              "Detections and the rule that produced them",
            ].map((t) => h("li", null, t)),
          ),
        ),
        h(
          "div",
          null,
          h("h4", null, "Never stored"),
          h(
            "ul",
            { class: "bullets" },
            [
              "Cookie values",
              "Full URLs with query values",
              "Page content or script source text",
              "Browsing history",
            ].map((t) => h("li", null, t)),
          ),
        ),
      ),
    ),
  );
};
