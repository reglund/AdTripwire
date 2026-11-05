/**
 * "Exposure": every documented host this browser contacted, told as a short story with the
 * path it took (site → ad frame → documented host), what the source says the host is, what
 * that means, and a copy-ready note for researchers. Built from stored detections only.
 */
import type { Digest, MonitoringStatus } from "@adtripwire/shared";
import {
  exposureStory,
  sightingText,
  type ExposureContact,
  type ExposureSummary,
} from "@adtripwire/correlation";
import {
  calendarCells,
  dayLabelText,
  monthLabels,
  morningLine,
  weekdayName,
  yesterdayOf,
  type CalendarCell,
  type CellState,
} from "../calendar.js";
import { externalLink, h } from "../dom.js";
import { formatTimestamp, relativeTime } from "../format.js";
import { t } from "../i18n.js";
import { detectionHash } from "../route.js";
import { rpc } from "../rpc.js";
import { card, kv, type View } from "./common.js";

const CLASS_LABEL: Record<ExposureContact["classification"], string> = {
  malicious: "Spyware delivery path",
  surveillance: "Campaign ad platform",
  contextual: "Related vendor",
};

const arrow = (): HTMLElement => h("li", { class: "chain-arrow", "aria-hidden": "true" }, "→");

function chain(c: ExposureContact): HTMLElement {
  const step = (label: string, values: string[], cls: string) =>
    h(
      "li",
      { class: `chain-step ${cls}` },
      h("span", { class: "chain-label" }, t(label)),
      h(
        "span",
        { class: "chain-value mono" },
        values.length ? values.join(", ") : t("not recorded"),
      ),
    );
  return h(
    "ol",
    { class: "chain", "aria-label": t("Path of the request") },
    step("Site", c.sites, "chain-site"),
    arrow(),
    step("Ad frame", c.via, "chain-via"),
    arrow(),
    step("Documented host", [c.host], "chain-host"),
  );
}

function copyButton(text: string): HTMLElement {
  const status = h("span", { class: "muted small", role: "status" });
  const btn = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        void navigator.clipboard.writeText(text).then(
          () => {
            status.textContent = t("Copied. Paste it into an email or issue.");
          },
          () => {
            status.textContent = t("Copying is not allowed here; select the text below instead.");
            pre.hidden = false;
          },
        );
      },
    },
    t("Copy note for researchers"),
  );
  const pre = h("pre", { class: "prompt-text", hidden: true }, text);
  return h("div", { class: "copy-row" }, btn, status, pre);
}

function contactCard(c: ExposureContact, status: MonitoringStatus): HTMLElement {
  const story = exposureStory(c);
  return h(
    "article",
    { class: `contact-card contact-${c.classification}` },
    h(
      "header",
      { class: "contact-head" },
      h("h3", { class: "mono" }, c.host),
      h(
        "span",
        { class: `class-pill class-${c.classification}` },
        t(CLASS_LABEL[c.classification]),
      ),
    ),
    h("p", { class: "contact-headline" }, story.headline),
    chain(c),
    h("p", null, story.body),
    h("p", { class: "contact-meaning" }, story.meaning),
    kv([
      [t("First seen"), formatTimestamp(c.firstSeen)],
      [t("Last seen"), `${formatTimestamp(c.lastSeen)} (${relativeTime(c.lastSeen)})`],
      [t("Days with contact"), c.days.join(", ")],
      [t("Requested path"), h("span", { class: "mono" }, c.paths.join(", ") || "—")],
      [
        t("Parameter names (values are never stored)"),
        h("span", { class: "mono" }, c.paramNames.join(", ") || "—"),
      ],
      [t("Source"), c.sourceUrl ? externalLink(c.sourceUrl, c.sourceTitle) : c.sourceTitle],
    ]),
    h(
      "div",
      { class: "button-row" },
      h(
        "a",
        { class: "btn", href: detectionHash(c.latestDetectionId) },
        t("Open the latest detection"),
      ),
    ),
    copyButton(sightingText(c, status.productVersion, status.capabilities.browser)),
  );
}

const LEGEND: Array<[CellState, string]> = [
  ["empty", "Nothing recorded"],
  ["seen", "Pages counted"],
  ["contact", "Contact with documented infrastructure"],
  ["strong", "Elevated detection"],
];

const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toLocaleString();

/** The calendar: one button per day, roving tabindex, the focused day's sentence in a status line. */
/** One span per week column (no inline styles under the extension CSP); labels sit in their column. */
function monthSpans(cells: readonly CalendarCell[]): HTMLElement[] {
  const labels = new Map(monthLabels(cells).map((m) => [m.column, m.label] as const));
  return Array.from({ length: 53 }, (_, col) => h("span", null, labels.get(col) ?? ""));
}

function calendar(digest: Digest): HTMLElement {
  const cells = calendarCells(digest.days, digest.today);
  const status = h(
    "p",
    { class: "cal-status", role: "status" },
    t("Select a day to see what was recorded."),
  );
  const buttons: Array<HTMLElement | null> = [];
  let current = cells.reduce((last, c, i) => (c.state === "future" ? last : i), 0);

  const select = (i: number): void => {
    const cell = cells[i];
    if (!cell || !buttons[i]) return;
    buttons[current]?.setAttribute("tabindex", "-1");
    buttons[i]?.setAttribute("tabindex", "0");
    current = i;
    status.textContent = dayLabelText(cell);
  };

  const cellEl = (cell: CalendarCell, i: number): HTMLElement => {
    if (cell.state === "future") {
      buttons.push(null);
      return h("span", { class: "day day-future", "aria-hidden": "true" });
    }
    const btn = h("button", {
      type: "button",
      class: `day day-${cell.state}${cell.date === digest.today ? " day-today" : ""}`,
      "aria-label": dayLabelText(cell),
      "aria-current": cell.date === digest.today ? "date" : null,
      tabindex: i === current ? "0" : "-1",
      "data-i": i,
      onclick: () => select(i),
      onfocus: () => select(i),
    });
    buttons.push(btn);
    return btn;
  };

  const STEP: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
  const onKey = (ev: Event): void => {
    const step = STEP[(ev as KeyboardEvent).key];
    if (step === undefined) return;
    ev.preventDefault();
    buttons[current + step]?.focus();
  };

  const grid = h(
    "div",
    {
      class: "cal-grid",
      role: "group",
      "aria-label": t("Daily counts, last 53 weeks"),
      onkeydown: onKey,
    },
    cells.map(cellEl),
  );
  const months = h("div", { class: "cal-months", "aria-hidden": "true" }, monthSpans(cells));
  const weekdays = h(
    "div",
    { class: "cal-weekdays", "aria-hidden": "true" },
    [0, 1, 2, 3, 4, 5, 6].map((r) => h("span", null, r % 2 === 0 ? weekdayName(r) : "")),
  );
  const withContacts = cells.filter((c) => c.contacts > 0).reverse();
  return h(
    "div",
    { class: "calendar" },
    h(
      "div",
      { class: "cal-scroll" },
      h("div", { class: "cal-layout" }, h("div"), months, weekdays, grid),
    ),
    status,
    h(
      "ul",
      { class: "cal-legend" },
      LEGEND.map(([state, label]) =>
        h("li", null, h("span", { class: `day day-${state}`, "aria-hidden": "true" }), t(label)),
      ),
    ),
    h(
      "details",
      { class: "cal-days" },
      h("summary", null, t("List days with contacts")),
      withContacts.length > 0
        ? h(
            "ul",
            null,
            withContacts.map((c) => h("li", null, dayLabelText(c))),
          )
        : h("p", { class: "muted" }, t("No days with contacts in this period.")),
    ),
    h(
      "p",
      { class: "muted small" },
      t(
        "Pages are only counted, never named. Days are in local time and are kept on this device for 400 days.",
      ),
    ),
  );
}

function morningSection(digest: Digest): HTMLElement {
  const line = morningLine(digest);
  const y = yesterdayOf(digest);
  const normal = digest.normalThirdPartyPerPage;
  return card(
    t("The last 365 days"),
    h("p", { class: "morning-line" }, line ?? t("Nothing was recorded for yesterday.")),
    y && normal !== null && y.pagesMeasured > 0
      ? h(
          "p",
          { class: "muted" },
          t("Yesterday {n} third-party domains per page on average; your 30-day normal is {m}.", {
            n: fmt1(y.thirdPartyDomainsTotal / y.pagesMeasured),
            m: fmt1(normal),
          }),
        )
      : null,
    calendar(digest),
  );
}

export const renderExposure: View = async () => {
  const [summary, status, digest] = await Promise.all([
    rpc<ExposureSummary>({ type: "get_exposure" }),
    rpc<MonitoringStatus>({ type: "get_status" }),
    rpc<Digest>({ type: "get_digest" }).catch(() => null),
  ]);
  const observed = status.metrics?.eventsObserved ?? 0;
  const since = status.metrics?.since;
  const found = summary.contacts.length > 0;
  const hero = h(
    "section",
    { class: `exposure-hero ${found ? "hero-found" : "hero-clear"}`, "aria-live": "polite" },
    h(
      "p",
      { class: "hero-title" },
      found
        ? t("Documented infrastructure was contacted")
        : t("No documented infrastructure contacted"),
    ),
    h(
      "p",
      { class: "hero-sub" },
      found
        ? t(
            "{contacts} contact(s) with {hosts} host(s) in the last {days} days; {total} host(s) in all stored history.",
            {
              contacts: summary.recentContacts,
              hosts: summary.recentHosts,
              days: summary.windowDays,
              total: summary.contacts.length,
            },
          )
        : since
          ? t("AdTripwire has watched {n} requests since {date}.", {
              n: observed.toLocaleString(),
              date: formatTimestamp(since),
            })
          : t("AdTripwire is watching ad traffic."),
    ),
    h(
      "p",
      { class: "hero-note" },
      found
        ? t(
            "Contacts show exposure to the ad-delivery path described in public reporting. They are not evidence of targeting or of anything reaching this device.",
          )
        : t(
            "This does not mean nothing happened: only documented hosts can be recognised, and the list is incomplete.",
          ),
    ),
  );
  return h(
    "div",
    { class: "view" },
    h("h2", null, t("Exposure")),
    digest ? morningSection(digest) : null,
    hero,
    summary.strongSignals > 0
      ? h(
          "p",
          { class: "notice-warn", role: "alert" },
          h("strong", null, t("Strong signals recorded. ")),
          t("{n} detection(s) at elevated priority or from correlation rules need review.", {
            n: summary.strongSignals,
          }),
          " ",
          h("a", { href: "#detections" }, t("Review detections")),
        )
      : null,
    ...summary.contacts.map((c) => contactCard(c, status)),
  );
};
