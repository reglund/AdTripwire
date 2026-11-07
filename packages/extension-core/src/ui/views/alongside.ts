/**
 * "Seen alongside": hostnames that appeared in the same ad frame as a documented host.
 * Leads for researchers, never detections: no severity, no colour coding, no verdict words.
 * Built from the read-only `get_alongside` response (hostnames, counts, UTC day keys).
 */
import type { AlongsideRow } from "@adtripwire/correlation";
import { h } from "../dom.js";
import { t } from "../i18n.js";
import { rpc } from "../rpc.js";
import { alongsideState, anchorLabels, type AlongsideResponse } from "../alongside.js";
import { card, tableWrap, type View } from "./common.js";

/** Factual explanation of an empty ranking. Never "all clear". */
function emptyText(listing: AlongsideResponse): string | null {
  const totals = listing.totals;
  switch (alongsideState(listing)) {
    case "listed":
      return null;
    case "no_anchors":
      return t(
        "No request to a documented host has been recorded since this list started collecting, so there is nothing to compare against yet. Documented hosts are rare; the list fills as they are observed.",
      );
    case "page_scope_only":
      return t(
        "{n} request(s) to documented hosts were recorded, but only from the top document of a page, not from an ad frame. Hostnames loaded by those pages are listed below as page scope; they do not count toward the ranking.",
        { n: totals.pageAnchors },
      );
    case "no_candidates":
      return t(
        "{n} request(s) to documented hosts were recorded from ad frames, but no other hostname was seen in the same frames so far.",
        { n: totals.frameAnchors },
      );
    case "below_minimum":
      return t(
        "{hosts} hostname(s) were seen alongside documented hosts in an ad frame, but none on {min} or more different days yet. A hostname is listed once it reaches {min} days.",
        { hosts: totals.frameHosts, min: totals.minAlongsideDays },
      );
  }
}

function summaryLine(listing: AlongsideResponse): string {
  const t0 = listing.totals;
  return t(
    "{n} request(s) to documented hosts recorded on {days} day(s): {frame} from ad frames, {page} from the top document of a page. {tracked} hostname(s) tracked.",
    {
      n: t0.anchorsSeen,
      days: t0.anchorDays,
      frame: t0.frameAnchors,
      page: t0.pageAnchors,
      tracked: t0.hostsTracked,
    },
  );
}

function table(
  caption: string,
  rows: readonly AlongsideRow[],
  hosts: Readonly<Record<string, string>>,
  pageScope: boolean,
): HTMLElement {
  const head = h(
    "tr",
    null,
    [
      "Hostname",
      pageScope ? "Days at page scope" : "Days alongside",
      "Documented host(s)",
      "Last seen",
    ].map((label) => h("th", { scope: "col" }, t(label))),
  );
  const body = rows.map((r) =>
    h(
      "tr",
      null,
      h("td", { class: "mono" }, r.hostname),
      h(
        "td",
        { class: "nowrap" },
        pageScope
          ? t("{n} day(s)", { n: r.pageDays })
          : t("{a} of {b} days", { a: r.alongsideDays, b: r.seenDays }),
      ),
      h("td", { class: "mono" }, anchorLabels(r.anchors, hosts).join(", ") || "—"),
      h("td", { class: "nowrap" }, r.lastSeen || "—"),
    ),
  );
  return tableWrap(
    caption,
    h(
      "table",
      { class: "data" },
      h("caption", { class: "sr-only" }, caption),
      h("thead", null, head),
      h("tbody", null, body),
    ),
  );
}

export const renderAlongside: View = async () => {
  const listing = await rpc<AlongsideResponse>({ type: "get_alongside" });
  const empty = emptyText(listing);
  return h(
    "div",
    { class: "view alongside" },
    h("h2", null, t("Seen alongside")),
    h(
      "p",
      null,
      t(
        "Hostnames that appeared in the same ad frame as a documented host. These are not detections and say nothing about the hosts themselves; they are leads for researchers. The list fills slowly: documented hosts are rare.",
      ),
    ),
    h("p", { class: "muted small" }, summaryLine(listing)),
    h(
      "p",
      { class: "muted small" },
      t(
        "Coverage depends on the browser: Firefox exposes the full frame ancestry, while browsers without it record fewer relations.",
      ),
    ),
    card(
      t("Seen alongside in an ad frame"),
      empty ? h("p", null, empty) : null,
      listing.rows.length > 0
        ? table(t("Seen alongside in an ad frame"), listing.rows, listing.anchorHosts, false)
        : null,
    ),
    listing.pageOnly.length > 0
      ? h(
          "section",
          { class: "card alongside-secondary", "aria-label": t("Page scope only") },
          h("h3", null, t("Page scope only")),
          h(
            "p",
            { class: "muted small" },
            t(
              "These hostnames were seen only while a documented host was requested by the top document of a page, so they are not tied to an ad frame. They are kept apart and do not count toward the list above.",
            ),
          ),
          table(t("Page scope only"), listing.pageOnly, listing.anchorHosts, true),
        )
      : null,
  );
};
