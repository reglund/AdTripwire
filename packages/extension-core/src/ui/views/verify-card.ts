import { externalLink, h } from "../dom.js";
import { t } from "../i18n.js";
import { readManifestInfo } from "../manifest-info.js";
import { card, kv } from "./common.js";

export const VERIFY_DOC_URL =
  "https://github.com/reglund/AdTripwire/blob/main/docs/verify-yourself.md";

/**
 * Shows what the browser itself loaded for this extension (the live manifest), so a reader can
 * compare it with the claims without trusting this code. Falls back to a plain notice.
 */
export function verifyCard(read?: () => unknown): HTMLElement {
  const info = readManifestInfo(read);
  const link = h("p", null, externalLink(VERIFY_DOC_URL, t("How to verify this yourself")));
  if (info === null) {
    return card(
      t("Check this yourself"),
      h("p", { class: "muted" }, t("Manifest unavailable.")),
      link,
    );
  }
  const list = (items: readonly string[]): Node =>
    items.length === 0
      ? h("span", { class: "muted" }, t("none"))
      : h(
          "ul",
          { class: "bullets" },
          items.map((i) => h("li", null, h("code", null, i))),
        );
  return card(
    t("Check this yourself"),
    h(
      "p",
      null,
      t(
        "This is the manifest the browser loaded for this extension, read live. Compare it with the claims in the documentation; the checks do not depend on who wrote the code.",
      ),
    ),
    kv([
      [t("Version"), info.version],
      [t("Content security policy (extension pages)"), h("code", null, info.csp)],
      [t("Permissions"), list(info.permissions)],
      [t("Host permissions"), list(info.hostPermissions)],
    ]),
    h(
      "p",
      null,
      t("This page cannot make network requests: the browser enforces the policy above."),
    ),
    link,
  );
}
