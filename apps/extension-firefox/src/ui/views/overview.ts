import type { Detection, MonitoringStatus } from "@adtripwire/shared";
import { h } from "../dom.js";
import {
  capabilityLabel,
  NO_DETECTIONS_NOTICE,
  severityLabel,
  summarizeVisibility,
} from "../format.js";
import { rpc } from "../rpc.js";
import { detectionHash } from "../route.js";
import {
  bulletList,
  card,
  chips,
  detectionsTable,
  kv,
  newestFirst,
  statusPill,
  timeEl,
  type View,
} from "./common.js";

export const renderOverview: View = async () => {
  const [status, detections] = await Promise.all([
    rpc<MonitoringStatus>({ type: "get_status" }),
    rpc<Detection[]>({ type: "list_detections", filter: { limit: 5 } }),
  ]);
  const recent = newestFirst(detections).slice(0, 5);
  const caps = status.capabilities;
  const visibility = summarizeVisibility(caps);
  const last = status.lastSignificant;

  return h(
    "div",
    { class: "view" },
    h("h2", null, "Overview"),
    card(
      "Monitoring status",
      h("p", null, statusPill(status)),
      kv([
        ["Host permission", status.hostPermissionGranted ? "Granted" : "Not granted"],
        ["Product version", status.productVersion],
        ["Ruleset version", status.rulesetVersion],
        ["Events stored", String(status.counts.eventsStored)],
        [
          "Last significant observation",
          last
            ? [
                `${last.summary} (${severityLabel(last.severity)}, `,
                timeEl(last.timestamp),
                ") ",
                h("a", { href: detectionHash(last.detectionId) }, "View"),
              ]
            : "None recorded",
        ],
      ]),
    ),
    card(
      "Counts",
      kv([
        ["Known IOC observations", String(status.counts.knownIocObservations)],
        ["Suspicious patterns", String(status.counts.suspiciousPatterns)],
        ["High-priority detections", String(status.counts.highPriority)],
        ["Detections stored", String(status.counts.detectionsTotal)],
      ]),
    ),
    card(
      "Browser and sensor capabilities",
      kv([
        [
          "Browser",
          `${caps.browser}${caps.browserVersion !== undefined ? ` ${caps.browserVersion}` : ""}`,
        ],
      ]),
      h("h4", null, "Declared capabilities"),
      chips(
        caps.capabilities.map((c) => capabilityLabel(c)),
        "No capabilities declared.",
      ),
      h("h4", null, "Notes"),
      bulletList(caps.notes, "No notes."),
    ),
    card(
      "Recent detections",
      recent.length === 0
        ? h("p", { class: "muted" }, "No detections recorded.")
        : detectionsTable(recent, "Five most recent detections"),
      h("p", null, h("a", { href: "#detections" }, "All detections")),
    ),
    h(
      "section",
      { class: "card callout", "aria-labelledby": "cansee-h" },
      h("h3", { id: "cansee-h" }, "What this tool can and cannot see"),
      h("p", { class: "callout-lead" }, NO_DETECTIONS_NOTICE),
      h(
        "div",
        { class: "two-col" },
        h("div", null, h("h4", null, "Can observe"), bulletList(visibility.canSee, "Nothing.")),
        h("div", null, h("h4", null, "Cannot observe"), bulletList(visibility.cannotSee, "—")),
      ),
    ),
  );
};
