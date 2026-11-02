import { clear, errorState, h, loadingState } from "./dom.js";
import { parseHash, routeTab, TABS, type Route, type TabName } from "./route.js";
import { renderDetectionDetail } from "./views/detection-detail.js";
import { renderDetections } from "./views/detections.js";
import { renderIndicators } from "./views/indicators.js";
import { renderOverview } from "./views/overview.js";
import { renderRules } from "./views/rules.js";
import { renderSettings } from "./views/settings.js";
import type { ViewContext } from "./views/common.js";
import { NO_DETECTIONS_NOTICE } from "./format.js";

const tabsEl = document.getElementById("tabs");
const mainEl = document.getElementById("main");
if (!tabsEl || !mainEl) throw new Error("Missing dashboard containers");
const tabList: HTMLElement = tabsEl;
const main: HTMLElement = mainEl;

const TITLES: Record<TabName, string> = {
  overview: "Overview",
  detections: "Detections",
  indicators: "Indicators",
  rules: "Rules",
  settings: "Settings",
};

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
      tab.label,
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
    case "indicators":
      return renderIndicators(ctx);
    case "rules":
      return renderRules(ctx);
    case "settings":
      return renderSettings(ctx);
  }
}

async function show(): Promise<void> {
  const route = parseHash(location.hash);
  const tab = routeTab(route);
  const token = ++renderToken;
  markActive(tab);
  document.title = `AdTripwire – ${route.name === "detection" ? "Detection detail" : TITLES[tab]}`;
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
      errorState("Could not load this page", err, () => void show()),
    );
  }
  if (token !== renderToken) return; // a newer navigation superseded this one

  const hadFocusInside =
    document.activeElement === document.body || main.contains(document.activeElement);
  clear(main);
  main.appendChild(content);
  main.appendChild(h("p", { class: "dash-footnote" }, NO_DETECTIONS_NOTICE));
  main.setAttribute("aria-busy", "false");
  if (hadFocusInside) main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
  // Diagnostic line (no data): lets the browser-level test confirm the page rendered.
  console.info(`[AdTripwire] dashboard rendered ${tab}${failed ? " (error state)" : ""}`);
}

buildTabs();
window.addEventListener("hashchange", () => void show());
void show();
