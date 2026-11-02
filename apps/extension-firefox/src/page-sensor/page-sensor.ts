/**
 * AdTripwire optional page sensor (Phase 2).
 *
 * Runs as an ISOLATED-WORLD content script, only in sub-frames (never top-level documents),
 * only when the user has enabled it in Settings. It reports structural facts about the frame
 * it lives in, never content:
 *   - an iframe inserted after load that is hidden (≤ 2x2 px or display:none),
 *   - a <script src> or 1x1 <img> inserted after load pointing at another host,
 *   - a `message` event whose data carries type "analytics_sdk_ready" (documented SDK) or a
 *     generic cross-origin object message with a "type" field.
 * Payloads contain only sanitized hostnames and small numbers. The background validates
 * every message (sender must be a tab sub-frame, shape must match) and drops anything else.
 * Threat model: docs/threat-model.md → Page sensor.
 */
(() => {
  if (window === window.top) return; // sub-frames only
  const MAX_SIGNALS = 40; // hard cap per frame lifetime
  const QUIET_AFTER_MS = 120_000; // stop observing two minutes after load
  let sent = 0;
  const t0 = performance.now();
  const ownHost = location.hostname.toLowerCase();

  type Kind =
    | "postmessage_sdk_ready"
    | "postmessage_wildcard_like"
    | "hidden_iframe_inserted"
    | "script_inserted"
    | "beacon_image_inserted";

  function hostOf(url: string | null): string | null {
    if (!url) return null;
    try {
      const u = new URL(url, location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  function send(kind: Kind, targetHostname: string | null): void {
    if (sent >= MAX_SIGNALS) return;
    if (performance.now() - t0 > QUIET_AFTER_MS) return;
    sent++;
    if (sent >= MAX_SIGNALS) observer.disconnect();
    const payload: Record<string, unknown> = {
      type: "page_signal",
      kind,
      msSinceLoad: Math.round(performance.now() - t0),
      // Wall-clock insertion time so the background can order the signal relative to the
      // network requests it caused (the message itself arrives later).
      insertedAt: Date.now(),
    };
    if (targetHostname) {
      payload.targetHostname = targetHostname;
      payload.crossOrigin = targetHostname !== ownHost;
    }
    try {
      void browser.runtime.sendMessage(payload).catch(() => undefined);
    } catch {
      /* extension context gone */
    }
  }

  function isHidden(el: HTMLIFrameElement): boolean {
    const w = parseInt(el.getAttribute("width") ?? "", 10);
    const h = parseInt(el.getAttribute("height") ?? "", 10);
    if ((Number.isFinite(w) && w <= 2) || (Number.isFinite(h) && h <= 2)) return true;
    const cs = el.style;
    const px = (v: string) => (/^\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : NaN);
    if (px(cs.width) <= 2 || px(cs.height) <= 2) return true;
    if (cs.display === "none" || cs.visibility === "hidden") return true;
    return false;
  }

  const MAX_SCAN_PER_MUTATION = 50;

  function examine(el: Element): void {
    const tag = el.tagName;
    if (tag === "IFRAME") {
      const f = el as HTMLIFrameElement;
      if (isHidden(f)) send("hidden_iframe_inserted", hostOf(f.getAttribute("src")));
    } else if (tag === "SCRIPT") {
      const host = hostOf((el as HTMLScriptElement).getAttribute("src"));
      if (host && host !== ownHost) send("script_inserted", host);
    } else if (tag === "IMG") {
      const img = el as HTMLImageElement;
      const w = parseInt(img.getAttribute("width") ?? "", 10);
      const h = parseInt(img.getAttribute("height") ?? "", 10);
      const host = hostOf(img.getAttribute("src"));
      if (host && host !== ownHost && w <= 1 && h <= 1) send("beacon_image_inserted", host);
    }
  }

  const observer = new MutationObserver((records) => {
    let scanned = 0;
    for (const r of records) {
      for (const node of Array.from(r.addedNodes)) {
        if (!(node instanceof Element)) continue;
        examine(node);
        // Elements inserted via innerHTML arrive as a subtree: look one level into it, bounded.
        if (scanned < MAX_SCAN_PER_MUTATION) {
          const nested = node.querySelectorAll("iframe,script,img");
          for (let i = 0; i < nested.length && scanned < MAX_SCAN_PER_MUTATION; i++, scanned++) {
            examine(nested[i]!);
          }
        }
      }
    }
  });

  // Observe from document_start: injected ad scripts typically insert their iframe while the
  // frame is still parsing, i.e. before DOMContentLoaded.
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), QUIET_AFTER_MS);

  window.addEventListener(
    "message",
    (ev) => {
      const data: unknown = ev.data;
      if (!data || typeof data !== "object") return;
      const type = (data as { type?: unknown }).type;
      if (typeof type !== "string") return;
      const fromHost = hostOf(ev.origin);
      if (type === "analytics_sdk_ready") send("postmessage_sdk_ready", fromHost);
      else if (fromHost && fromHost !== ownHost) send("postmessage_wildcard_like", fromHost);
    },
    { passive: true },
  );
})();
