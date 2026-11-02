import type { Detection, MonitoringStatus } from "@adtripwire/shared";
import { h } from "../dom.js";
import {
  capabilityLabel,
  indicatorAgeDays,
  INDICATOR_STALE_DAYS,
  metricRows,
  NO_DETECTIONS_NOTICE,
  severityLabel,
  summarizeVisibility,
} from "../format.js";
import { t } from "../i18n.js";
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

function staleIndicatorNotice(status: MonitoringStatus): HTMLElement | null {
  const curated = status.indicatorSets.filter((s) => !s.imported && !s.synthetic);
  const ages = curated
    .map((s) => ({ s, days: indicatorAgeDays(s.asOf) }))
    .filter((x): x is { s: (typeof curated)[number]; days: number } => x.days !== null);
  const stale = ages.filter((x) => x.days > INDICATOR_STALE_DAYS);
  if (stale.length === 0) return null;
  const x = stale[0]!;
  return h(
    "div",
    { class: "notice-warn", role: "status" },
    h("strong", null, t("Indicator set may be out of date. ")),
    t(
      "The curated set is {days} days old (as of {date}). Documented infrastructure rotates, so newer hosts may be missing. Check the project's releases for a signed indicator update and import it under Indicators.",
      { days: x.days, date: x.s.asOf },
    ),
  );
}

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
    h("h2", null, t("Overview")),
    staleIndicatorNotice(status),
    card(
      t("Monitoring status"),
      h("p", null, statusPill(status)),
      kv([
        [t("Host permission"), status.hostPermissionGranted ? t("Granted") : t("Not granted")],
        [t("Product version"), status.productVersion],
        [t("Ruleset version"), status.rulesetVersion],
        [t("Events stored"), String(status.counts.eventsStored)],
        [
          t("Last significant observation"),
          last
            ? [
                `${last.summary} (${severityLabel(last.severity)}, `,
                timeEl(last.timestamp),
                ") ",
                h("a", { href: detectionHash(last.detectionId) }, t("View")),
              ]
            : t("None recorded"),
        ],
      ]),
    ),
    card(
      t("Counts"),
      kv([
        [t("Known IOC observations"), String(status.counts.knownIocObservations)],
        [t("Suspicious patterns"), String(status.counts.suspiciousPatterns)],
        [t("High-priority detections"), String(status.counts.highPriority)],
        [t("Detections stored"), String(status.counts.detectionsTotal)],
      ]),
    ),
    status.metrics
      ? card(
          t("Runtime metrics"),
          kv(metricRows(status.metrics).map((r) => [r.label, r.value])),
          h(
            "p",
            { class: "muted small" },
            t("Counting since"),
            " ",
            timeEl(status.metrics.since),
            ".",
          ),
          h(
            "p",
            { class: "muted small" },
            t("These are aggregate counters only. No URLs are stored in them."),
          ),
        )
      : null,
    card(
      t("Browser and sensor capabilities"),
      kv([
        [
          t("Browser"),
          `${caps.browser}${caps.browserVersion !== undefined ? ` ${caps.browserVersion}` : ""}`,
        ],
      ]),
      h("h4", null, t("Declared capabilities")),
      chips(
        caps.capabilities.map((c) => capabilityLabel(c)),
        t("No capabilities declared."),
      ),
      h("h4", null, t("Notes")),
      bulletList(caps.notes, t("No notes.")),
    ),
    card(
      t("Recent detections"),
      recent.length === 0
        ? h("p", { class: "muted" }, t("No detections recorded."))
        : detectionsTable(recent, t("Five most recent detections")),
      h("p", null, h("a", { href: "#detections" }, t("All detections"))),
    ),
    h(
      "section",
      { class: "card callout", "aria-labelledby": "cansee-h" },
      h("h3", { id: "cansee-h" }, t("What this tool can and cannot see")),
      h("p", { class: "callout-lead" }, t(NO_DETECTIONS_NOTICE)),
      h(
        "div",
        { class: "two-col" },
        h(
          "div",
          null,
          h("h4", null, t("Can observe")),
          bulletList(visibility.canSee, t("Nothing.")),
        ),
        h("div", null, h("h4", null, t("Cannot observe")), bulletList(visibility.cannotSee, "—")),
      ),
    ),
  );
};
