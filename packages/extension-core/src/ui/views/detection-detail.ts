import type {
  Detection,
  DetectionCluster,
  DetectionWithNote,
  NormalizedEvent,
  Settings,
} from "@adtripwire/shared";
import { errorMessage, errorState, externalLink, h, severityBadge, type Child } from "../dom.js";
import {
  categoryLabel,
  confidenceLabel,
  describePageSignal,
  formatBytes,
  formatSanitizedUrl,
  formatTimeMs,
  formatTimestamp,
  humanize,
  pluralize,
  sensorLabel,
  severityLabel,
} from "../format.js";
import { clampNote, NOTE_MAX_LENGTH } from "../exports.js";
import { currentLanguage, t } from "../i18n.js";
import { detectionRuleName, detectionText } from "../detection-text.js";
import { rpc } from "../rpc.js";
import {
  bulletList,
  card,
  englishFallbackNote,
  kv,
  loadRuleNames,
  tableWrap,
  timeEl,
  uid,
} from "./common.js";
import { exportGroup } from "./export-actions.js";
import { clusterHash } from "../route.js";
import { assistPanel } from "../assist/panel.js";

const shortId = (id: string): string => id.slice(0, 8);

function eventRowId(detectionId: string, eventId: string): string {
  return `ev-${detectionId}-${eventId}`;
}

function eventStatus(ev: NormalizedEvent): string {
  if (ev.pageSignal) return t("not applicable");
  const base = t(humanize(ev.requestStatus));
  return ev.statusCode !== undefined ? `${base} (${ev.statusCode})` : base;
}

function eventNotes(ev: NormalizedEvent): string {
  const parts: string[] = ev.observationLimitations.map((l) => t(humanize(l)));
  const ps = ev.pageSignal ? describePageSignal(ev.pageSignal) : null;
  if (ps?.timing) parts.push(ps.timing);
  const ri = ev.responseInspection;
  if (ri) {
    parts.push(
      ri.truncated
        ? t("Inspected {size} (truncated)", { size: formatBytes(ri.observedBytes) })
        : t("Inspected {size}", { size: formatBytes(ri.observedBytes) }),
      ri.markers.length > 0
        ? t("Markers: {list}", { list: ri.markers.join(", ") })
        : t("No technique markers"),
    );
  }
  return parts.length > 0 ? parts.join("; ") : t("None");
}

function eventCell(ev: NormalizedEvent): HTMLElement {
  const ps = ev.pageSignal ? describePageSignal(ev.pageSignal) : null;
  return h(
    "td",
    null,
    ps ? t("Page signal: {label}", { label: ps.label }) : t(humanize(ev.eventType)),
    h("div", { class: "muted small" }, t("Sensor: {name}", { name: sensorLabel(ev.sensor) })),
  );
}

function destinationCell(ev: NormalizedEvent): HTMLElement {
  if (!ev.pageSignal) {
    return h(
      "td",
      { class: "mono wrap", title: t("Query parameter names only; values are never stored.") },
      formatSanitizedUrl(ev.destination),
    );
  }
  const ps = describePageSignal(ev.pageSignal);
  return h(
    "td",
    { class: "wrap" },
    ps.targetHostname !== null
      ? h("span", { class: "mono" }, ps.targetHostname)
      : h("span", { class: "muted" }, t("No target hostname")),
    ps.crossOrigin ? [" ", h("span", { class: "badge kind" }, t("cross-origin"))] : null,
  );
}

function eventTable(detectionId: string, events: NormalizedEvent[]): HTMLElement {
  const head = [
    "Time",
    "Event",
    "Resource",
    "Destination",
    "Frame depth",
    "Status",
    "Size",
    "Limitations and notes",
  ];
  const rows = events.map((ev) =>
    h(
      "tr",
      { id: eventRowId(detectionId, ev.eventId), tabindex: "-1" },
      h(
        "td",
        { class: "nowrap", title: formatTimestamp(ev.timestamp) },
        formatTimeMs(ev.timestamp),
      ),
      eventCell(ev),
      h("td", null, ev.pageSignal ? t("not applicable") : (ev.resourceType ?? t("unknown"))),
      destinationCell(ev),
      h("td", null, ev.frameContext.depth < 0 ? t("unknown") : String(ev.frameContext.depth)),
      h("td", null, eventStatus(ev)),
      h(
        "td",
        { class: "nowrap" },
        ev.responseSizeIfObservable !== undefined
          ? formatBytes(ev.responseSizeIfObservable)
          : t("unknown"),
      ),
      h("td", null, eventNotes(ev)),
    ),
  );
  return tableWrap(
    t("Event sequence"),
    h(
      "table",
      { class: "data" },
      h("caption", { class: "sr-only" }, t("Events supporting this detection, oldest first")),
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          head.map((label) => h("th", { scope: "col" }, t(label))),
        ),
      ),
      h("tbody", null, rows),
    ),
  );
}

function eventLinks(detectionId: string, ids: string[], available: Set<string>): Child {
  if (ids.length === 0) return h("span", { class: "muted small" }, t("No linked events."));
  return h(
    "span",
    { class: "event-links small" },
    t("Events:"),
    " ",
    ids.map((id) =>
      available.has(id)
        ? h(
            "button",
            {
              type: "button",
              class: "linklike mono",
              title: t("Show event {id} in the event sequence", { id }),
              onclick: () => {
                const row = document.getElementById(eventRowId(detectionId, id));
                row?.scrollIntoView({ block: "center" });
                row?.focus({ preventScroll: true });
                row?.classList.add("flash");
                setTimeout(() => row?.classList.remove("flash"), 1500);
              },
            },
            shortId(id),
          )
        : h(
            "span",
            { class: "mono muted", title: t("Event {id} is no longer stored", { id }) },
            shortId(id),
          ),
    ),
  );
}

async function eventSection(d: Detection): Promise<{ node: HTMLElement; available: Set<string> }> {
  const available = new Set<string>();
  let body: HTMLElement;
  if (d.eventIds.length === 0) {
    body = h("p", { class: "muted" }, t("No events are linked to this detection."));
  } else {
    try {
      const events = await rpc<NormalizedEvent[]>({ type: "get_events", eventIds: d.eventIds });
      const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
      for (const ev of sorted) available.add(ev.eventId);
      const missing = d.eventIds.length - sorted.length;
      body = h(
        "div",
        null,
        missing > 0
          ? h(
              "p",
              { class: "muted" },
              t("{count} no longer stored (removed by retention limits or deletion).", {
                count: pluralize(missing, "linked event"),
              }),
            )
          : null,
        sorted.length > 0
          ? eventTable(d.detectionId, sorted)
          : h("p", { class: "muted" }, t("No stored events.")),
      );
    } catch (err) {
      body = errorState(t("Could not load events"), err);
    }
  }
  return { node: card(t("Event sequence"), body), available };
}

function noteSection(d: DetectionWithNote): HTMLElement {
  const id = uid("note");
  const textarea = h("textarea", {
    id,
    rows: 6,
    maxlength: NOTE_MAX_LENGTH,
    "aria-describedby": `${id}-help ${id}-count`,
  });
  textarea.value = clampNote(d.note ?? "");
  const count = h("span", { id: `${id}-count`, class: "muted small" });
  const updateCount = (): void => {
    count.textContent = t("{n} / {max} characters", {
      n: textarea.value.length,
      max: NOTE_MAX_LENGTH,
    });
  };
  updateCount();
  textarea.addEventListener("input", updateCount);
  const status = h("p", { class: "muted", role: "status" });
  if (d.note !== undefined && d.note !== "")
    status.textContent = t("A previously saved note is shown above.");
  const save = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        save.disabled = true;
        status.textContent = t("Saving…");
        void (async () => {
          try {
            await rpc<DetectionWithNote>({
              type: "set_detection_note",
              detectionId: d.detectionId,
              note: clampNote(textarea.value),
            });
            status.textContent = t("Saved at {time}.", { time: formatTimestamp(Date.now()) });
          } catch (err) {
            status.textContent = t("Saving failed: {error}", { error: errorMessage(err) });
          } finally {
            save.disabled = false;
          }
        })();
      },
    },
    t("Save note"),
  );
  return card(
    t("Analyst notes"),
    h(
      "div",
      { class: "field" },
      h("label", { for: id }, t("Your notes on this detection")),
      textarea,
      h(
        "p",
        { id: `${id}-help`, class: "muted small" },
        t(
          "Plain text, stored locally in this browser profile and included in hand-off packages. Do not paste passwords or other secrets.",
        ),
      ),
      count,
    ),
    h("div", { class: "button-row" }, save),
    status,
  );
}

export async function renderDetectionDetail(id: string): Promise<Node> {
  const d = await rpc<DetectionWithNote | null>({ type: "get_detection", detectionId: id });
  const back = h("p", null, h("a", { href: "#detections" }, t("← All detections")));
  if (!d) {
    return h(
      "div",
      { class: "view" },
      back,
      errorState(
        t("Detection not found"),
        t("It may have been removed by retention limits or deletion."),
      ),
    );
  }

  const { node: sequence, available } = await eventSection(d);
  const [clusters, settings, ruleNames] = await Promise.all([
    rpc<DetectionCluster[]>({ type: "get_clusters" }).catch(() => [] as DetectionCluster[]),
    rpc<Settings>({ type: "get_settings" }),
    loadRuleNames(),
  ]);
  const text = detectionText(d, currentLanguage());
  const cluster = clusters.find((c) => c.detectionIds.includes(d.detectionId));
  const related = card(
    t("Related activity"),
    cluster && cluster.detectionIds.length > 1
      ? h(
          "p",
          null,
          t("This detection belongs to a group of {n} related detections.", {
            n: cluster.detectionIds.length,
          }),
          " ",
          h("a", { href: clusterHash(cluster.clusterId) }, t("View the group")),
          h("span", { class: "muted" }, ` (${cluster.summary})`),
        )
      : h(
          "p",
          { class: "muted" },
          t(
            "No other stored detection shares a request, indicator, hostname, domain or tab window with this one.",
          ),
        ),
  );

  const evidence =
    d.evidence.length === 0
      ? h("p", { class: "muted" }, t("No evidence items recorded."))
      : h(
          "ol",
          { class: "evidence" },
          d.evidence.map((e) =>
            h(
              "li",
              null,
              h("span", { class: `badge kind kind-${e.kind}` }, e.kind),
              " ",
              e.observed,
              h("div", null, eventLinks(d.detectionId, e.eventIds, available)),
            ),
          ),
        );

  const references =
    d.references.length === 0
      ? h("p", { class: "muted" }, t("No source references."))
      : h(
          "ul",
          { class: "bullets" },
          d.references.map((r) => h("li", null, externalLink(r.url, r.title))),
        );

  return h(
    "div",
    { class: "view detection-detail" },
    back,
    h("h2", null, text.summary),
    text.fallback ? englishFallbackNote() : null,
    h(
      "div",
      { class: "detail-meta" },
      severityBadge(d.severity, severityLabel(d.severity)),
      h("span", null, t("Confidence: {level}", { level: confidenceLabel(d.confidence) })),
      h("span", null, categoryLabel(d.category)),
      h("span", null, timeEl(d.timestamp)),
    ),
    h(
      "p",
      { class: "confidence-rationale" },
      h("strong", null, t("Confidence rationale:"), " "),
      text.confidenceRationale,
    ),
    card(
      t("Export"),
      exportGroup({
        detectionIds: [d.detectionId],
        evidenceFilename: (p) =>
          `adtripwire-detection-${shortId(d.detectionId)}-${p}-${new Date().toISOString().slice(0, 10)}.json`,
      }),
    ),
    noteSection(d),
    card(
      t("What was observed"),
      h("p", null, text.summary),
      kv([
        [t("First event"), formatTimestamp(d.firstEventTimestamp)],
        [t("Latest event"), formatTimestamp(d.timestamp)],
        [
          t("Subject hostnames"),
          d.subjectHostnames.length > 0 ? d.subjectHostnames.join(", ") : t("none recorded"),
        ],
        [
          t("Occurrences"),
          d.occurrenceCount > 1
            ? t("Re-observed {n} times in the suppression window", { n: d.occurrenceCount })
            : "1",
        ],
      ]),
    ),
    card(t("Why it matters"), h("p", null, text.significance)),
    card(
      t("Rule"),
      kv([
        [t("Rule name"), detectionRuleName(d, ruleNames)],
        [t("Rule ID"), h("code", null, d.ruleId)],
        [t("Rule version"), d.ruleVersion],
        [t("Category"), categoryLabel(d.category)],
        [
          t("Matched indicators"),
          d.matchedIndicatorIds.length > 0 ? d.matchedIndicatorIds.join(", ") : t("none"),
        ],
      ]),
    ),
    card(t("Evidence"), evidence),
    sequence,
    card(t("Source references"), references),
    card(
      t("Possible benign explanations"),
      bulletList(text.alternativeExplanations, t("None listed.")),
    ),
    card(
      t("Suggested investigation steps"),
      bulletList(text.recommendedActions, t("None listed.")),
    ),
    card(
      t("Detection limitations"),
      h("h4", null, t("Limitations")),
      bulletList(text.limitations, t("None listed.")),
      h("h4", null, t("What the sensor could not see")),
      bulletList(text.missingVisibility, t("None listed.")),
    ),
    related,
    assistPanel({ detectionId: d.detectionId }, settings),
  );
}
