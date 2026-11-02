import type { Detection, DetectionWithNote, NormalizedEvent } from "@adtripwire/shared";
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
import { rpc } from "../rpc.js";
import { bulletList, card, kv, tableWrap, timeEl, uid } from "./common.js";
import { exportGroup } from "./export-actions.js";

const shortId = (id: string): string => id.slice(0, 8);

function eventRowId(detectionId: string, eventId: string): string {
  return `ev-${detectionId}-${eventId}`;
}

function eventStatus(ev: NormalizedEvent): string {
  if (ev.pageSignal) return "not applicable";
  const base = humanize(ev.requestStatus);
  return ev.statusCode !== undefined ? `${base} (${ev.statusCode})` : base;
}

function eventNotes(ev: NormalizedEvent): string {
  const parts: string[] = ev.observationLimitations.map((l) => humanize(l));
  const ps = ev.pageSignal ? describePageSignal(ev.pageSignal) : null;
  if (ps?.timing) parts.push(ps.timing);
  const ri = ev.responseInspection;
  if (ri) {
    parts.push(
      `Inspected ${formatBytes(ri.observedBytes)}${ri.truncated ? " (truncated)" : ""}`,
      ri.markers.length > 0 ? `Markers: ${ri.markers.join(", ")}` : "No technique markers",
    );
  }
  return parts.length > 0 ? parts.join("; ") : "None";
}

function eventCell(ev: NormalizedEvent): HTMLElement {
  const ps = ev.pageSignal ? describePageSignal(ev.pageSignal) : null;
  return h(
    "td",
    null,
    ps ? `Page signal: ${ps.label}` : humanize(ev.eventType),
    h("div", { class: "muted small" }, `Sensor: ${sensorLabel(ev.sensor)}`),
  );
}

function destinationCell(ev: NormalizedEvent): HTMLElement {
  if (!ev.pageSignal) {
    return h(
      "td",
      { class: "mono wrap", title: "Query parameter names only; values are never stored." },
      formatSanitizedUrl(ev.destination),
    );
  }
  const ps = describePageSignal(ev.pageSignal);
  return h(
    "td",
    { class: "wrap" },
    ps.targetHostname !== null
      ? h("span", { class: "mono" }, ps.targetHostname)
      : h("span", { class: "muted" }, "No target hostname"),
    ps.crossOrigin ? [" ", h("span", { class: "badge kind" }, "cross-origin")] : null,
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
      h("td", null, ev.pageSignal ? "not applicable" : (ev.resourceType ?? "unknown")),
      destinationCell(ev),
      h("td", null, ev.frameContext.depth < 0 ? "unknown" : String(ev.frameContext.depth)),
      h("td", null, eventStatus(ev)),
      h(
        "td",
        { class: "nowrap" },
        ev.responseSizeIfObservable !== undefined
          ? formatBytes(ev.responseSizeIfObservable)
          : "unknown",
      ),
      h("td", null, eventNotes(ev)),
    ),
  );
  return tableWrap(
    "Event sequence",
    h(
      "table",
      { class: "data" },
      h("caption", { class: "sr-only" }, "Events supporting this detection, oldest first"),
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          head.map((t) => h("th", { scope: "col" }, t)),
        ),
      ),
      h("tbody", null, rows),
    ),
  );
}

function eventLinks(detectionId: string, ids: string[], available: Set<string>): Child {
  if (ids.length === 0) return h("span", { class: "muted small" }, "No linked events.");
  return h(
    "span",
    { class: "event-links small" },
    "Events: ",
    ids.map((id) =>
      available.has(id)
        ? h(
            "button",
            {
              type: "button",
              class: "linklike mono",
              title: `Show event ${id} in the event sequence`,
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
        : h("span", { class: "mono muted", title: `Event ${id} is no longer stored` }, shortId(id)),
    ),
  );
}

async function eventSection(d: Detection): Promise<{ node: HTMLElement; available: Set<string> }> {
  const available = new Set<string>();
  let body: HTMLElement;
  if (d.eventIds.length === 0) {
    body = h("p", { class: "muted" }, "No events are linked to this detection.");
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
              `${pluralize(missing, "linked event")} no longer stored (removed by retention limits or deletion).`,
            )
          : null,
        sorted.length > 0
          ? eventTable(d.detectionId, sorted)
          : h("p", { class: "muted" }, "No stored events."),
      );
    } catch (err) {
      body = errorState("Could not load events", err);
    }
  }
  return { node: card("Event sequence", body), available };
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
    count.textContent = `${textarea.value.length} / ${NOTE_MAX_LENGTH} characters`;
  };
  updateCount();
  textarea.addEventListener("input", updateCount);
  const status = h("p", { class: "muted", role: "status" });
  if (d.note !== undefined && d.note !== "")
    status.textContent = "A previously saved note is shown above.";
  const save = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        save.disabled = true;
        status.textContent = "Saving…";
        void (async () => {
          try {
            await rpc<DetectionWithNote>({
              type: "set_detection_note",
              detectionId: d.detectionId,
              note: clampNote(textarea.value),
            });
            status.textContent = `Saved at ${formatTimestamp(Date.now())}.`;
          } catch (err) {
            status.textContent = `Saving failed: ${errorMessage(err)}`;
          } finally {
            save.disabled = false;
          }
        })();
      },
    },
    "Save note",
  );
  return card(
    "Analyst notes",
    h(
      "div",
      { class: "field" },
      h("label", { for: id }, "Your notes on this detection"),
      textarea,
      h(
        "p",
        { id: `${id}-help`, class: "muted small" },
        "Plain text, stored locally in this browser profile and included in hand-off packages. Do not paste passwords or other secrets.",
      ),
      count,
    ),
    h("div", { class: "button-row" }, save),
    status,
  );
}

export async function renderDetectionDetail(id: string): Promise<Node> {
  const d = await rpc<DetectionWithNote | null>({ type: "get_detection", detectionId: id });
  const back = h("p", null, h("a", { href: "#detections" }, "← All detections"));
  if (!d) {
    return h(
      "div",
      { class: "view" },
      back,
      errorState(
        "Detection not found",
        "It may have been removed by retention limits or deletion.",
      ),
    );
  }

  const { node: sequence, available } = await eventSection(d);

  const evidence =
    d.evidence.length === 0
      ? h("p", { class: "muted" }, "No evidence items recorded.")
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
      ? h("p", { class: "muted" }, "No source references.")
      : h(
          "ul",
          { class: "bullets" },
          d.references.map((r) => h("li", null, externalLink(r.url, r.title))),
        );

  return h(
    "div",
    { class: "view detection-detail" },
    back,
    h("h2", null, d.summary),
    h(
      "div",
      { class: "detail-meta" },
      severityBadge(d.severity, severityLabel(d.severity)),
      h("span", null, `Confidence: ${confidenceLabel(d.confidence)}`),
      h("span", null, categoryLabel(d.category)),
      h("span", null, timeEl(d.timestamp)),
    ),
    h(
      "p",
      { class: "confidence-rationale" },
      h("strong", null, "Confidence rationale: "),
      d.confidenceRationale,
    ),
    card(
      "Export",
      exportGroup({
        detectionIds: [d.detectionId],
        evidenceFilename: (p) =>
          `adtripwire-detection-${shortId(d.detectionId)}-${p}-${new Date().toISOString().slice(0, 10)}.json`,
      }),
    ),
    noteSection(d),
    card(
      "What was observed",
      h("p", null, d.summary),
      kv([
        ["First event", formatTimestamp(d.firstEventTimestamp)],
        ["Latest event", formatTimestamp(d.timestamp)],
        [
          "Subject hostnames",
          d.subjectHostnames.length > 0 ? d.subjectHostnames.join(", ") : "none recorded",
        ],
        [
          "Occurrences",
          d.occurrenceCount > 1
            ? `Re-observed ${d.occurrenceCount} times in the suppression window`
            : "1",
        ],
      ]),
    ),
    card("Why it matters", h("p", null, d.significance)),
    card(
      "Rule",
      kv([
        ["Rule name", d.ruleName],
        ["Rule ID", h("code", null, d.ruleId)],
        ["Rule version", d.ruleVersion],
        ["Category", categoryLabel(d.category)],
        [
          "Matched indicators",
          d.matchedIndicatorIds.length > 0 ? d.matchedIndicatorIds.join(", ") : "none",
        ],
      ]),
    ),
    card("Evidence", evidence),
    sequence,
    card("Source references", references),
    card("Possible benign explanations", bulletList(d.alternativeExplanations, "None listed.")),
    card("Suggested investigation steps", bulletList(d.recommendedActions, "None listed.")),
    card(
      "Detection limitations",
      h("h4", null, "Limitations"),
      bulletList(d.limitations, "None listed."),
      h("h4", null, "What the sensor could not see"),
      bulletList(d.missingVisibility, "None listed."),
    ),
  );
}
