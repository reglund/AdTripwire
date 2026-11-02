import type { MonitoringStatus, Settings } from "@adtripwire/shared";
import { errorMessage, errorState, h, loadingState, replaceChildren } from "./dom.js";
import {
  monitoringPill,
  NO_DETECTIONS_NOTICE,
  PILL_TEXT,
  relativeTime,
  severityLabel,
} from "./format.js";
import { requestHostPermission, rpc } from "./rpc.js";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app element");
const app: HTMLElement = root;

let busy = false;
let actionError: string | null = null;

async function load(): Promise<void> {
  replaceChildren(app, loadingState());
  try {
    const [status, settings] = await Promise.all([
      rpc<MonitoringStatus>({ type: "get_status" }),
      rpc<Settings>({ type: "get_settings" }),
    ]);
    render(status, settings);
  } catch (err) {
    replaceChildren(
      app,
      h("header", { class: "popup-header" }, h("h1", null, "AdTripwire")),
      errorState("Status unavailable", err, () => void load()),
      footerNote(),
    );
  }
}

async function act(fn: () => Promise<unknown>): Promise<void> {
  if (busy) return;
  busy = true;
  actionError = null;
  try {
    await fn();
  } catch (err) {
    actionError = errorMessage(err);
  } finally {
    busy = false;
    await load();
  }
}

function footerNote(): HTMLElement {
  return h("p", { class: "popup-note" }, NO_DETECTIONS_NOTICE);
}

function summaryRow(label: string, value: number): HTMLElement {
  return h("div", { class: "summary-row" }, h("dt", null, label), h("dd", null, String(value)));
}

function render(status: MonitoringStatus, settings: Settings): void {
  const pill = monitoringPill(status);
  const enabled = settings.monitoring.enabled;
  const last = status.lastSignificant;

  const children: Node[] = [
    h(
      "header",
      { class: "popup-header" },
      h("h1", null, "AdTripwire"),
      h("span", { class: `pill pill-${pill}`, role: "status" }, PILL_TEXT[pill]),
    ),
  ];

  if (pill === "permission") {
    children.push(
      h(
        "section",
        { class: "popup-section" },
        h(
          "p",
          null,
          "Monitoring needs permission to observe network requests. Nothing is observed until it is granted.",
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-primary btn-block",
            onclick: () => void act(() => requestHostPermission()),
          },
          "Grant monitoring permission",
        ),
      ),
    );
  }

  children.push(
    h(
      "section",
      { class: "popup-section", "aria-labelledby": "summary-h" },
      h("h2", { id: "summary-h" }, "Summary"),
      h(
        "dl",
        { class: "summary" },
        summaryRow("Known IOC observations", status.counts.knownIocObservations),
        summaryRow("Suspicious patterns", status.counts.suspiciousPatterns),
        summaryRow("High-priority detections", status.counts.highPriority),
      ),
    ),
    h(
      "section",
      { class: "popup-section", "aria-labelledby": "last-h" },
      h("h2", { id: "last-h" }, "Last significant observation"),
      last
        ? h(
            "div",
            null,
            h("p", { class: "last-summary" }, last.summary),
            h(
              "p",
              { class: "muted" },
              `${severityLabel(last.severity)} · `,
              h(
                "time",
                { datetime: new Date(last.timestamp).toISOString() },
                relativeTime(last.timestamp),
              ),
            ),
          )
        : h("p", { class: "muted" }, "None recorded"),
    ),
  );

  if (actionError !== null) {
    children.push(
      h("p", { class: "state state-error", role: "alert" }, `Action failed: ${actionError}`),
    );
  }

  children.push(
    h(
      "div",
      { class: "popup-actions" },
      h(
        "button",
        {
          type: "button",
          class: "btn btn-primary btn-block",
          onclick: () => {
            void browser.tabs
              .create({ url: browser.runtime.getURL("dashboard.html") })
              .then(() => window.close());
          },
        },
        "Open investigation dashboard",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-block",
          onclick: () =>
            void act(() => rpc({ type: "update_settings", patch: { enabled: !enabled } })),
        },
        enabled ? "Pause monitoring" : "Resume monitoring",
      ),
    ),
    footerNote(),
  );

  replaceChildren(app, children);
}

void load();
