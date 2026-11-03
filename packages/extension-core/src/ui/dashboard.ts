import { clear, errorState, h, loadingState } from "./dom.js";
import { parseHash, routeTab, TABS, type Route, type TabName } from "./route.js";
import { renderDetectionDetail } from "./views/detection-detail.js";
import { renderDetections } from "./views/detections.js";
import { renderIndicators } from "./views/indicators.js";
import { renderOverview } from "./views/overview.js";
import { renderRules } from "./views/rules.js";
import { renderTimeline } from "./views/timeline.js";
import { renderClusterDetail, renderCorrelation } from "./views/correlation.js";
import { renderExposure } from "./views/exposure.js";
import { renderSettings } from "./views/settings.js";
import type { ViewContext } from "./views/common.js";
import { NO_DETECTIONS_NOTICE } from "./format.js";
import { applyLanguageSetting, t } from "./i18n.js";
import { rpc } from "./rpc.js";
import type { Settings } from "@adtripwire/shared";

const tabsEl = document.getElementById("tabs");
const mainEl = document.getElementById("main");
if (!tabsEl || !mainEl) throw new Error("Missing dashboard containers");
const tabList: HTMLElement = tabsEl;
const main: HTMLElement = mainEl;

const TITLES: Record<TabName, string> = {
  overview: "Overview",
  detections: "Detections",
  timeline: "Timeline",
  correlation: "Related activity",
  exposure: "Exposure",
  indicators: "Indicators",
  rules: "Rules",
  settings: "Settings",
};

/** Translates the static page chrome (skip link, navigation labels, tab labels). */
function translateChrome(): void {
  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = t("Skip to content");
  const tagline = document.querySelector(".tagline");
  if (tagline) tagline.textContent = t("Detect the threat behind the ad");
  for (const el of Array.from(document.querySelectorAll("nav, #tabs"))) {
    el.setAttribute("aria-label", t("Dashboard sections"));
  }
  for (const tab of TABS) {
    const a = document.getElementById(`tab-${tab.name}`);
    if (a) a.textContent = t(tab.label);
  }
}

/** Applies the stored UI language; falls back to English when settings cannot be read. */
async function applyLanguage(): Promise<void> {
  try {
    applyLanguageSetting(await rpc<Settings>({ type: "get_settings" }));
  } catch {
    // keep English; the view itself will show the error state if the background is down
  }
  translateChrome();
}

function navigate(name: TabName): void {
  location.hash = `#${name}`;
}

function buildTabs(): void {
  TABS.forEach((tab, index) => {
    const a = h(
      "a",
      {
        role: "tab",
        id: `tab-${tab.name}`,
        href: `#${tab.name}`,
        "aria-controls": "main",
        "aria-selected": "false",
        tabindex: "-1",
        "data-tab": tab.name,
        onkeydown: (ev: Event) => {
          const key = (ev as KeyboardEvent).key;
          let next = -1;
          if (key === "ArrowRight") next = (index + 1) % TABS.length;
          else if (key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
          else if (key === "Home") next = 0;
          else if (key === "End") next = TABS.length - 1;
          if (next < 0) return;
          ev.preventDefault();
          const target = TABS[next];
          if (!target) return;
          navigate(target.name);
          document.getElementById(`tab-${target.name}`)?.focus();
        },
      },
      t(tab.label),
    );
    tabList.appendChild(a);
  });
}

function markActive(active: TabName): void {
  for (const a of Array.from(tabList.querySelectorAll<HTMLElement>("[role=tab]"))) {
    const isActive = a.dataset["tab"] === active;
    a.setAttribute("aria-selected", String(isActive));
    a.setAttribute("tabindex", isActive ? "0" : "-1");
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  main.setAttribute("aria-labelledby", `tab-${active}`);
}

let renderToken = 0;

async function renderRoute(route: Route): Promise<Node> {
  const ctx: ViewContext = { reload: () => void show() };
  switch (route.name) {
    case "overview":
      return renderOverview(ctx);
    case "detections":
      return renderDetections(ctx);
    case "detection":
      return renderDetectionDetail(route.id);
    case "timeline":
      return renderTimeline(ctx);
    case "correlation":
      return renderCorrelation(ctx);
    case "exposure":
      return renderExposure(ctx);
    case "cluster":
      return renderClusterDetail(route.id);
    case "assist_selftest": {
      // DEV builds with --assist only; anything else shows the overview.
      if (__ADTRIPWIRE_DEV__ && __ADTRIPWIRE_ASSIST__) {
        const { runAssistSelfTest } = await import("./assist/selftest.js");
        return runAssistSelfTest();
      }
      return renderOverview(ctx);
    }
    case "indicators":
      return renderIndicators(ctx);
    case "rules":
      return renderRules(ctx);
    case "settings":
      return renderSettings(ctx);
  }
}

async function show(): Promise<void> {
  await applyLanguage();
  const route = parseHash(location.hash);
  const tab = routeTab(route);
  const token = ++renderToken;
  markActive(tab);
  const title =
    route.name === "detection"
      ? t("Detection detail")
      : route.name === "cluster"
        ? t("Related activity detail")
        : t(TITLES[tab]);
  document.title = `AdTripwire – ${title}`;
  main.setAttribute("aria-busy", "true");
  clear(main);
  main.appendChild(loadingState());

  let content: Node;
  let failed = false;
  try {
    content = await renderRoute(route);
  } catch (err) {
    failed = true;
    content = h(
      "div",
      { class: "view" },
      errorState(t("Could not load this page"), err, () => void show()),
    );
  }
  if (token !== renderToken) return; // a newer navigation superseded this one

  const hadFocusInside =
    document.activeElement === document.body || main.contains(document.activeElement);
  clear(main);
  main.appendChild(content);
  main.appendChild(h("p", { class: "dash-footnote" }, t(NO_DETECTIONS_NOTICE)));
  main.setAttribute("aria-busy", "false");
  if (hadFocusInside) main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  // Diagnostic line (no data): lets the browser-level test confirm the page rendered.
  console.info(`[AdTripwire] dashboard rendered ${tab}${failed ? " (error state)" : ""}`);
}

buildTabs();
window.addEventListener("hashchange", () => void show());
void show();
