import type { ExportFile, HandoffCoverLanguages, HandoffPreview } from "@adtripwire/shared";
import { HANDOFF_NOTE_MAX_LENGTH } from "@adtripwire/shared";
import { CANNOT_CONCLUDE_EN, CAN_CONCLUDE_EN, PROFILE_EXPLANATION_EN } from "../../handoff-text.js";
import { downloadText, errorMessage, externalLink, h } from "../dom.js";
import { isExportFile, safeFilename } from "../exports.js";
import { formatTimestamp } from "../format.js";
import { currentLanguage, t } from "../i18n.js";
import { rpc } from "../rpc.js";
import { uid } from "./common.js";

export const ACCESS_NOW_URL = "https://www.accessnow.org/help/";
export const CITIZEN_LAB_URL = "https://citizenlab.ca/contact/";

/**
 * "Share with a specialist": a sheet that shows, before any file exists, what a hand-off
 * package will contain and what the recipient can and cannot conclude from it. The optional
 * note is read from the textarea only when the file is created and is never stored.
 * `detectionIds` omitted means everything.
 */
export function shareSheet(opts: {
  detectionIds?: string[];
  initialProfile?: "default" | "strict";
}): HTMLElement {
  const scope = opts.detectionIds ? { detectionIds: opts.detectionIds } : {};
  const panelId = uid("share-panel");
  const panel = h("div", { id: panelId, class: "share-sheet", hidden: true });
  const toggle = h(
    "button",
    {
      type: "button",
      class: "btn",
      "aria-expanded": "false",
      "aria-controls": panelId,
      onclick: () => {
        const open = panel.hasAttribute("hidden");
        if (open) {
          panel.removeAttribute("hidden");
          if (panel.childNodes.length === 0) buildPanel();
        } else {
          panel.setAttribute("hidden", "");
          // Closing the sheet discards the note and the cover note held in the form.
          panel.replaceChildren();
        }
        toggle.setAttribute("aria-expanded", String(open));
      },
    },
    t("Share with a specialist…"),
  );

  function buildPanel(): void {
    const profileId = uid("share-profile");
    const profileSelect = h(
      "select",
      { id: profileId, "aria-describedby": `${profileId}-help` },
      h("option", { value: "default" }, t("Default (sanitized hostnames)")),
      h("option", { value: "strict" }, t("Strict (pseudonymised hostnames)")),
    );
    profileSelect.value = opts.initialProfile ?? "default";
    const profile = (): "default" | "strict" =>
      profileSelect.value === "strict" ? "strict" : "default";
    const profileHelp = h("p", {
      id: `${profileId}-help`,
      class: "muted small",
      "aria-live": "polite",
    });

    const included = h("div", { class: "share-included", "aria-live": "polite" });
    let previewToken = 0;
    const refreshPreview = (): void => {
      profileHelp.textContent = t(PROFILE_EXPLANATION_EN[profile()]);
      const token = ++previewToken;
      included.replaceChildren(h("p", { class: "muted" }, t("Counting…")));
      void (async () => {
        try {
          const p = await rpc<HandoffPreview>({
            type: "preview_handoff",
            profile: profile(),
            ...scope,
          });
          if (token !== previewToken) return;
          included.replaceChildren(previewList(p));
        } catch (err) {
          if (token !== previewToken) return;
          included.replaceChildren(
            h("p", { class: "field-error", role: "alert" }, errorMessage(err)),
          );
        }
      })();
    };
    profileSelect.addEventListener("change", refreshPreview);

    const noteId = uid("share-note");
    const note = h("textarea", {
      id: noteId,
      rows: "5",
      maxlength: String(HANDOFF_NOTE_MAX_LENGTH),
      autocomplete: "off",
      spellcheck: "false",
      "aria-describedby": `${noteId}-help`,
    });
    const langId = uid("share-lang");
    const langSelect = h(
      "select",
      { id: langId },
      h("option", { value: "en" }, t("English")),
      h("option", { value: "en+nb" }, t("English and Norwegian")),
    );
    langSelect.value = currentLanguage() === "nb" ? "en+nb" : "en";

    const status = h("p", { class: "muted", role: "status" });
    // The cover note of the last created package, kept in memory only so that the separate
    // .md download is one more click (a second download without a click is unreliable).
    let coverNoteText: string | null = null;
    const coverButton = h(
      "button",
      {
        type: "button",
        class: "btn",
        hidden: true,
        onclick: () => {
          if (coverNoteText === null) return;
          downloadText(coverNoteFilename(), coverNoteText, "text/markdown");
          status.textContent = t("Downloaded {filename}.", { filename: coverNoteFilename() });
        },
      },
      t("Download the cover note (.md)"),
    );
    const clearCoverNote = (): void => {
      coverNoteText = null;
      coverButton.setAttribute("hidden", "");
    };
    note.addEventListener("input", clearCoverNote);
    profileSelect.addEventListener("change", clearCoverNote);
    langSelect.addEventListener("change", clearCoverNote);
    const create = h(
      "button",
      {
        type: "button",
        class: "btn btn-primary",
        onclick: () => {
          create.disabled = true;
          status.textContent = t("Preparing export…");
          clearCoverNote();
          void (async () => {
            try {
              const coverLanguages: HandoffCoverLanguages =
                langSelect.value === "en+nb" ? "en+nb" : "en";
              const text = note.value;
              const file = await rpc<ExportFile>({
                type: "export_handoff",
                profile: profile(),
                coverLanguages,
                ...(text.trim().length > 0 ? { note: text.slice(0, HANDOFF_NOTE_MAX_LENGTH) } : {}),
                ...scope,
              });
              if (!isExportFile(file))
                throw new Error(t("The background returned an unexpected export."));
              const name = safeFilename(file.filename, "adtripwire-handoff.json");
              downloadText(name, file.text, file.mediaType);
              coverNoteText = extractCoverNote(file.text);
              if (coverNoteText !== null) coverButton.removeAttribute("hidden");
              else coverButton.setAttribute("hidden", "");
              status.textContent = t("Downloaded {filename}.", { filename: name });
            } catch (err) {
              status.textContent = t("Export failed: {error}", { error: errorMessage(err) });
            } finally {
              create.disabled = false;
            }
          })();
        },
      },
      t("Create hand-off package"),
    );

    panel.replaceChildren(
      h("h4", null, t("Share with a specialist")),
      h(
        "p",
        { class: "muted" },
        t(
          "Nothing is created until you press the button at the bottom. The file is saved on this computer; AdTripwire does not send it anywhere.",
        ),
      ),
      h(
        "div",
        { class: "field" },
        h("label", { for: profileId }, t("Redaction profile")),
        profileSelect,
        profileHelp,
      ),
      h("h5", null, t("What will be included")),
      included,
      h(
        "div",
        { class: "share-checklist" },
        h("h5", null, t("What the recipient can conclude")),
        h(
          "ul",
          { class: "bullets" },
          CAN_CONCLUDE_EN.map((i) => h("li", null, t(i))),
        ),
        h("h5", null, t("What the recipient cannot conclude")),
        h(
          "ul",
          { class: "bullets" },
          CANNOT_CONCLUDE_EN.map((i) => h("li", null, t(i))),
        ),
      ),
      h(
        "div",
        { class: "field" },
        h("label", { for: noteId }, t("Optional note to the recipient")),
        note,
        h(
          "p",
          { id: `${noteId}-help`, class: "muted small" },
          t(
            "Plain text, up to 2000 characters. It goes only into this file as a quoted block and is never saved by AdTripwire. It is not checked or redacted, so leave out anything you do not want the recipient to see.",
          ),
        ),
      ),
      h(
        "div",
        { class: "field" },
        h("label", { for: langId }, t("Cover note language")),
        langSelect,
      ),
      h("h5", null, t("Where to send it")),
      h(
        "ul",
        { class: "bullets" },
        h(
          "li",
          null,
          externalLink(ACCESS_NOW_URL, t("Access Now Digital Security Helpline")),
          " ",
          t("(free help for people at risk)"),
        ),
        h("li", null, t("Your organisation's IT security team or CERT")),
        h("li", null, externalLink(CITIZEN_LAB_URL, t("Citizen Lab"))),
      ),
      h(
        "p",
        { class: "muted small" },
        t(
          "These links open in a new tab. Attach the saved file yourself; AdTripwire sends nothing.",
        ),
      ),
      h("div", { class: "button-row" }, create, coverButton),
      status,
    );
    refreshPreview();
  }

  return h("div", { class: "share-wrap" }, toggle, panel);
}

const coverNoteFilename = (): string =>
  `adtripwire-cover-note-${new Date().toISOString().slice(0, 10)}.md`;

/** The cover note Markdown from a hand-off package, or null if the package has none. */
function extractCoverNote(packageText: string): string | null {
  try {
    const cover = (JSON.parse(packageText) as { coverNote?: unknown }).coverNote;
    return typeof cover === "string" && cover.length > 0 ? cover : null;
  } catch {
    return null;
  }
}

function previewList(p: HandoffPreview): HTMLElement {
  return h(
    "ul",
    { class: "bullets" },
    h("li", null, t("{n} detection(s)", { n: p.detections })),
    h("li", null, t("{n} supporting event(s)", { n: p.events })),
    h(
      "li",
      null,
      p.seenAlongsideOmitted
        ? t("Seen-alongside hostnames are left out by the strict profile.")
        : t("{n} Seen-alongside row(s)", { n: p.seenAlongsideRows }),
    ),
    p.firstTimestamp !== undefined && p.lastTimestamp !== undefined
      ? h(
          "li",
          null,
          t("Period: {from} to {to}", {
            from: formatTimestamp(p.firstTimestamp),
            to: formatTimestamp(p.lastTimestamp),
          }),
        )
      : null,
  );
}
