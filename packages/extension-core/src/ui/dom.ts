/**
 * Tiny DOM helpers. Text is always inserted via createTextNode / textContent, never innerHTML,
 * so strings coming from the background (hostnames, summaries, references) cannot inject markup.
 */
import { safeHttpUrl } from "./format.js";
import { t } from "./i18n.js";

export type AttrValue = string | number | boolean | null | undefined | ((ev: Event) => void);
export type Attrs = Record<string, AttrValue>;
export type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (typeof value === "function") {
        if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
        continue;
      }
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (Array.isArray(child)) append(parent, child);
    else if (child === null || child === undefined || child === false) continue;
    else if (typeof child === "string" || typeof child === "number") {
      parent.appendChild(document.createTextNode(String(child)));
    } else parent.appendChild(child);
  }
}

export function clear(el: Node): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function replaceChildren(el: Node, ...children: Child[]): void {
  clear(el);
  append(el, children);
}

/** External link. Non-http(s) URLs are rendered as plain text, never as links. */
export function externalLink(url: string, label: string): Node {
  const safe = safeHttpUrl(url);
  if (safe === null) return document.createTextNode(`${label} (${url})`);
  return h("a", { href: safe, target: "_blank", rel: "noopener noreferrer" }, label);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Error panel with an optional retry button. Announced to assistive technology. */
export function errorState(title: string, err: unknown, retry?: () => void): HTMLElement {
  return h(
    "div",
    { class: "state state-error", role: "alert" },
    h("p", { class: "state-title" }, title),
    h("p", { class: "state-detail" }, errorMessage(err)),
    retry
      ? h("button", { type: "button", class: "btn", onclick: () => retry() }, t("Retry"))
      : null,
  );
}

export function loadingState(label?: string): HTMLElement {
  return h("p", { class: "state state-loading", role: "status" }, label ?? t("Loading…"));
}

/** Triggers a client-side download of `text` as `filename`. */
export function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename, hidden: true });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function severityBadge(severity: string, label: string): HTMLElement {
  return h("span", { class: `badge sev sev-${severity}` }, label);
}
