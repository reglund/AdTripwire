/**
 * Signed indicator update card (Phase 6). Two steps: verify (shows version, key, hash and
 * the diff against the active curated set) and activate. Rollback removes the bundle and
 * returns to the built-in set. Files are chosen locally; nothing is fetched.
 */
import type { MonitoringStatus, SignedBundlePreview } from "@adtripwire/shared";
import { errorMessage, h, replaceChildren } from "../dom.js";
import { formatTimestamp } from "../format.js";
import { t } from "../i18n.js";
import { rpc } from "../rpc.js";
import { card, kv, uid } from "./common.js";

type SetMeta = MonitoringStatus["indicatorSets"][number];

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error(t("The file could not be read as text.")));
    reader.onerror = () => reject(new Error(t("The file could not be read.")));
    reader.readAsText(file);
  });
}

function previewView(p: SignedBundlePreview): HTMLElement {
  if (!p.ok) {
    return h(
      "div",
      { class: "notice-warn", role: "alert" },
      h("strong", null, t("The bundle was rejected. Nothing changed.")),
      h(
        "ul",
        { class: "bullets" },
        p.errors.map((e) => h("li", null, e)),
      ),
    );
  }
  const m = p.meta!;
  const d = p.diff;
  return h(
    "div",
    null,
    h("p", null, h("strong", null, t("Signature verified."))),
    kv([
      [t("Bundle version"), m.version],
      [t("Replaces active version"), p.activeVersion ?? t("(none)")],
      [t("Created"), m.createdAt],
      [t("Signing key"), h("code", null, m.keyId)],
      ["SHA-256", h("code", { class: "wrap" }, m.sha256)],
      [t("Indicators"), String(p.indicatorCount ?? 0)],
      d
        ? [
            t("Changes"),
            t(
              "{added} added, {removed} removed, {reclassified} reclassified, {validityChanged} validity changed, {unchanged} unchanged",
              {
                added: d.added,
                removed: d.removed,
                reclassified: d.reclassified,
                validityChanged: d.validityChanged,
                unchanged: d.unchanged,
              },
            ),
          ]
        : [t("Changes"), t("n/a")],
    ]),
    m.changelog.length > 0
      ? h(
          "div",
          null,
          h("h4", null, t("Changelog")),
          h(
            "ul",
            { class: "bullets" },
            m.changelog.map((c) => h("li", null, c)),
          ),
        )
      : null,
    d && d.lines.length > 0
      ? h(
          "details",
          null,
          h(
            "summary",
            null,
            d.added + d.removed + d.reclassified + d.validityChanged > d.lines.length
              ? t("Change list ({n}, truncated)", { n: d.lines.length })
              : t("Change list ({n})", { n: d.lines.length }),
          ),
          h("pre", { class: "prompt-text" }, d.lines.join("\n")),
        )
      : null,
  );
}

export function signedBundleCard(
  sets: readonly SetMeta[],
  onChanged: () => Promise<void>,
): HTMLElement {
  const signed = sets.find((s) => s.signed);
  const fileId = uid("sb-file");
  const file = h("input", { type: "file", id: fileId, accept: ".json,application/json" });
  const status = h("p", { class: "muted", role: "status" });
  const out = h("div", { class: "import-output" });
  let verifiedText: string | null = null;

  const activate = h(
    "button",
    { type: "button", class: "btn btn-primary", disabled: true },
    t("Activate this bundle"),
  );
  const verify = h(
    "button",
    {
      type: "button",
      class: "btn",
      onclick: () => {
        const chosen = file.files?.[0] ?? null;
        replaceChildren(out);
        activate.disabled = true;
        verifiedText = null;
        if (!chosen) {
          status.textContent = t("Choose a .signed.json file first.");
          return;
        }
        if (chosen.size > 20 * 1024 * 1024) {
          status.textContent = t("The file is larger than 20 MB.");
          return;
        }
        verify.disabled = true;
        status.textContent = t("Verifying signature…");
        void (async () => {
          try {
            const text = await readFileText(chosen);
            const p = await rpc<SignedBundlePreview>({ type: "verify_signed_bundle", text });
            replaceChildren(out, previewView(p));
            status.textContent = p.ok ? t("Review the changes, then activate.") : "";
            if (p.ok) {
              verifiedText = text;
              activate.disabled = false;
            }
          } catch (err) {
            status.textContent = t("Verification failed: {error}", { error: errorMessage(err) });
          } finally {
            verify.disabled = false;
          }
        })();
      },
    },
    t("Verify bundle"),
  );
  activate.addEventListener("click", () => {
    if (!verifiedText) return;
    activate.disabled = true;
    status.textContent = t("Activating…");
    const text = verifiedText;
    void (async () => {
      try {
        const p = await rpc<SignedBundlePreview>({ type: "activate_signed_bundle", text });
        if (!p.ok) {
          replaceChildren(out, previewView(p));
          status.textContent = "";
          return;
        }
        status.textContent = t("Bundle {version} is active.", { version: p.meta?.version ?? "" });
        file.value = "";
        await onChanged();
      } catch (err) {
        status.textContent = t("Activation failed: {error}", { error: errorMessage(err) });
        activate.disabled = false;
      }
    })();
  });

  const rollback = signed
    ? h(
        "button",
        {
          type: "button",
          class: "btn btn-danger",
          onclick: (ev: Event) => {
            const btn = ev.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            status.textContent = t("Returning to the built-in set…");
            void rpc<MonitoringStatus>({ type: "remove_signed_bundle" }).then(
              () => onChanged(),
              (err: unknown) => {
                status.textContent = t("Rollback failed: {error}", { error: errorMessage(err) });
                btn.disabled = false;
              },
            );
          },
        },
        t("Roll back to the built-in set"),
      )
    : null;

  return card(
    t("Signed indicator update"),
    h(
      "p",
      null,
      t(
        "The project publishes signed updates of the curated set. Download the .signed.json file yourself and import it here; the signature is verified against the key built into this extension before anything changes. The extension never fetches updates.",
      ),
    ),
    signed
      ? kv([
          [
            t("Active bundle"),
            t("{version} (built-in version {builtIn})", {
              version: signed.version,
              builtIn: signed.signed!.builtInVersion,
            }),
          ],
          [t("Signing key"), h("code", null, signed.signed!.keyId)],
          [t("Activated"), formatTimestamp(signed.signed!.activatedAt)],
        ])
      : h("p", { class: "muted" }, t("No signed bundle is active; the built-in set is in use.")),
    h(
      "div",
      { class: "field" },
      h("label", { for: fileId }, t("Signed bundle (.signed.json)")),
      file,
    ),
    h("div", { class: "button-row" }, verify, activate, rollback),
    status,
    out,
  );
}
