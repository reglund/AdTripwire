/** Hash routing for the dashboard. Pure so it can be tested without a DOM. */

export type Route =
  | { name: "overview" }
  | { name: "exposure" }
  | { name: "detections" }
  | { name: "detection"; id: string }
  | { name: "timeline" }
  | { name: "correlation" }
  | { name: "cluster"; id: string }
  | { name: "assist_selftest" }
  | { name: "indicators" }
  | { name: "rules" }
  | { name: "settings" };

export type TabName =
  | "overview"
  | "exposure"
  | "detections"
  | "timeline"
  | "correlation"
  | "indicators"
  | "rules"
  | "settings";

export const TABS: ReadonlyArray<{ name: TabName; label: string }> = [
  { name: "overview", label: "Overview" },
  { name: "exposure", label: "Exposure" },
  { name: "detections", label: "Detections" },
  { name: "timeline", label: "Timeline" },
  { name: "correlation", label: "Related activity" },
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
    case "correlation":
      return { name: "correlation" };
    case "exposure":
      return { name: "exposure" };
    case "cluster": {
      const id = rest.join("/");
      return /^c-[0-9a-f]{8}$/.test(id) ? { name: "cluster", id } : { name: "correlation" };
    }
    case "assist-selftest":
      return { name: "assist_selftest" };
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
  switch (route.name) {
    case "detection":
      return "detections";
    case "cluster":
      return "correlation";
    case "assist_selftest":
      return "settings";
    default:
      return route.name;
  }
}

export function clusterHash(id: string): string {
  return `#cluster/${id}`;
}

export function detectionHash(id: string): string {
  return `#detection/${encodeURIComponent(id)}`;
}
