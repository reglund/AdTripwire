/** Hash routing for the dashboard. Pure so it can be tested without a DOM. */

export type Route =
  | { name: "overview" }
  | { name: "detections" }
  | { name: "detection"; id: string }
  | { name: "timeline" }
  | { name: "indicators" }
  | { name: "rules" }
  | { name: "settings" };

export type TabName = "overview" | "detections" | "timeline" | "indicators" | "rules" | "settings";

export const TABS: ReadonlyArray<{ name: TabName; label: string }> = [
  { name: "overview", label: "Overview" },
  { name: "detections", label: "Detections" },
  { name: "timeline", label: "Timeline" },
  { name: "indicators", label: "Indicators" },
  { name: "rules", label: "Rules" },
  { name: "settings", label: "Settings" },
];

/** Parses `location.hash`. Unknown or empty hashes fall back to the overview. */
export function parseHash(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [head = "", ...rest] = raw.split("/");
  switch (head) {
    case "detections":
      return { name: "detections" };
    case "detection": {
      const joined = rest.join("/");
      let id = joined;
      try {
        id = decodeURIComponent(joined);
      } catch {
        // keep the raw value; the background will report an unknown id
      }
      return id.length > 0 ? { name: "detection", id } : { name: "detections" };
    }
    case "timeline":
      return { name: "timeline" };
    case "indicators":
      return { name: "indicators" };
    case "rules":
      return { name: "rules" };
    case "settings":
      return { name: "settings" };
    default:
      return { name: "overview" };
  }
}

export function routeTab(route: Route): TabName {
  return route.name === "detection" ? "detections" : route.name;
}

export function detectionHash(id: string): string {
  return `#detection/${encodeURIComponent(id)}`;
}
