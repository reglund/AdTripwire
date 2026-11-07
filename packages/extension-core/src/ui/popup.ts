import type { Digest, MonitoringStatus, Settings } from "@adtripwire/shared";
import type { ExposureSummary } from "@adtripwire/correlation";
import { morningLine } from "./calendar.js";
import { errorMessage, errorState, h, loadingState, replaceChildren } from "./dom.js";
import {
  monitoringPill,
  NO_DETECTIONS_NOTICE,
  PILL_TEXT,
  relativeTime,
  severityLabel,
} from "./format.js";
import { applyLanguageSetting, currentLanguage, t } from "./i18n.js";
import { requestHostPermission, rpc } from "./rpc.js";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app element");
const app: HTMLElement = root;

let busy = false;
let actionError: string | null = null;

async function load(): Promise<void> {
  replaceChildren(app, loadingState());
  try {
    const [status, settings, exposure, digest] = await Promise.all([
      rpc<MonitoringStatus>({ type: "get_status" }),
      rpc<Settings>({ type: "get_settings" }),
      rpc<ExposureSummary>({ type: "get_exposure" }).catch(() => null),
      rpc<Digest>({ type: "get_digest" }).catch(() => null),
    ]);
    applyLanguageSetting(settings);
    render(status, settings, exposure, digest);
  } catch (err) {
    replaceChildren(
      app,
      h("header", { class: "popup-header" }, h("h1", null, "AdTripwire")),
      errorState(t("Status unavailable"), err, () => void load()),
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
  return h("p", { class: "popup-note" }, t(NO_DETECTIONS_NOTICE));
}

function openDashboard(hash: string): void {
  void browser.tabs
    .create({ url: browser.runtime.getURL(`dashboard.html${hash}`) })
    .then(() => window.close());
}

/** The answer first: has this browser contacted documented infrastructure? */
function exposureHeadline(
  status: MonitoringStatus,
  e: ExposureSummary,
  digest: Digest | null,
): HTMLElement {
  const morning = digest ? morningLine(digest) : null;
  const found = e.recentHosts > 0;
  const strong = e.strongSignals > 0;
  return h(
    "section",
    {
      class: `popup-hero ${strong ? "hero-strong" : found ? "hero-found" : "hero-clear"}`,
      role: "status",
    },
    h(
      "p",
      { class: "hero-title" },
      strong
        ? t("Strong signals need review")
        : found
          ? t("Documented infrastructure contacted")
          : t("No documented infrastructure seen in the last {days} days", { days: e.windowDays }),
    ),
    h(
      "p",
      { class: "hero-sub" },
      found || strong
        ? t("{contacts} contact(s) with {hosts} host(s) in the last {days} days.", {
            contacts: e.recentContacts,
            hosts: e.recentHosts,
            days: e.windowDays,
          })
        : (morning ??
            t("Watching ad traffic: {n} requests observed.", {
              n: (status.metrics?.eventsObserved ?? 0).toLocaleString(),
            })),
    ),
    found || strong
      ? h(
          "button",
          {
            type: "button",
            class: "btn btn-primary btn-block",
            onclick: () => openDashboard(strong ? "#detections" : "#exposure"),
          },
          t("See what happened"),
        )
      : null,
  );
}

function summaryRow(label: string, value: number): HTMLElement {
  return h("div", { class: "summary-row" }, h("dt", null, label), h("dd", null, String(value)));
}

function render(
  status: MonitoringStatus,
  settings: Settings,
  exposure: ExposureSummary | null,
  digest: Digest | null,
): void {
  const pill = monitoringPill(status);
  const enabled = settings.monitoring.enabled;
  const last = status.lastSignificant;

  const children: Node[] = [
    h(
      "header",
      { class: "popup-header" },
      h("h1", null, "AdTripwire"),
      h("span", { class: `pill pill-${pill}`, role: "status" }, t(PILL_TEXT[pill])),
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
          t(
            "Monitoring needs permission to observe network requests. Nothing is observed until it is granted.",
          ),
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-primary btn-block",
            onclick: () => void act(() => requestHostPermission()),
          },
          t("Grant monitoring permission"),
        ),
      ),
    );
  }

  if (exposure && pill !== "permission") children.push(exposureHeadline(status, exposure, digest));

  children.push(
    h(
      "section",
      { class: "popup-section", "aria-labelledby": "summary-h" },
      h("h2", { id: "summary-h" }, t("Summary")),
      h(
        "dl",
        { class: "summary" },
        summaryRow(t("Known IOC observations"), status.counts.knownIocObservations),
        summaryRow(t("Suspicious patterns"), status.counts.suspiciousPatterns),
        summaryRow(t("High-priority detections"), status.counts.highPriority),
      ),
    ),
    h(
      "section",
      { class: "popup-section", "aria-labelledby": "last-h" },
      h("h2", { id: "last-h" }, t("Last significant observation")),
      last
        ? h(
            "div",
            null,
            h(
              "p",
              { class: "last-summary" },
              currentLanguage() === "nb" && last.summaryNb ? last.summaryNb : last.summary,
            ),
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
        : h("p", { class: "muted" }, t("None recorded")),
    ),
  );

  if (actionError !== null) {
    children.push(
      h(
        "p",
        { class: "state state-error", role: "alert" },
        t("Action failed: {error}", { error: actionError }),
      ),
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
        t("Open investigation dashboard"),
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-block",
          onclick: () =>
            void act(() => rpc({ type: "update_settings", patch: { enabled: !enabled } })),
        },
        enabled ? t("Pause monitoring") : t("Resume monitoring"),
      ),
    ),
    footerNote(),
  );

  replaceChildren(app, children);
}

void load();
