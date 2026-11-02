import type { Severity } from "@adtripwire/shared";

export const SEVERITY_RANK: Record<Severity, number> = {
  informational: 0,
  suspicious: 1,
  elevated: 2,
  high_priority: 3,
};

export const SEVERITY_TEXT: Record<Severity, string> = {
  informational: "informational",
  suspicious: "suspicious",
  elevated: "elevated",
  high_priority: "high priority",
};

export function maxSeverity(list: readonly Severity[]): Severity {
  let best: Severity = "informational";
  for (const s of list) if (SEVERITY_RANK[s] > SEVERITY_RANK[best]) best = s;
  return best;
}
