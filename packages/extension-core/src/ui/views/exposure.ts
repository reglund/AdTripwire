/**
 * "Exposure": every documented host this browser contacted, told as a short story with the
 * path it took (site → ad frame → documented host), what the source says the host is, what
 * that means, and a copy-ready note for researchers. Built from stored detections only.
 */
import type { MonitoringStatus } from "@adtripwire/shared";
import {
  exposureStory,
  sightingText,
  type ExposureContact,
  type ExposureSummary,
} from "@adtripwire/correlation";
import { externalLink, h } from "../dom.js";
import { formatTimestamp, relativeTime } from "../format.js";
import { t } from "../i18n.js";
import { detectionHash } from "../route.js";
import { rpc } from "../rpc.js";
import { kv, type View } from "./common.js";

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

export const renderExposure: View = async () => {
  const [summary, status] = await Promise.all([
    rpc<ExposureSummary>({ type: "get_exposure" }),
    rpc<MonitoringStatus>({ type: "get_status" }),
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
