import type { NormalizedEvent } from "@adtripwire/shared";
import { hasIdentifierLikeParam } from "../params.js";
import { NOAS_RESOURCE_TYPES, isNoasPath } from "./common.js";
import type { RuleContext } from "./types.js";

/** NOAS/getAd request pattern: documented path, plausible resource type, identifier-like query macro. */
export function isNoasPattern(e: NormalizedEvent): boolean {
  if (!isNoasPath(e.destination.pathPattern)) return false;
  if (e.resourceType !== undefined && !NOAS_RESOURCE_TYPES.has(e.resourceType)) return false;
  return hasIdentifierLikeParam(e.destination.queryParamNames);
}

/** NOAS pattern, or contact with a surveillance indicator whose role is "noas". */
export function isNoasContact(e: NormalizedEvent, ctx: RuleContext): boolean {
  if (e.eventType === "response_inspected") return false;
  if (isNoasPattern(e)) return true;
  return ctx
    .indicatorMatches(e)
    .some((m) => m.indicator.classification === "surveillance" && m.indicator.role === "noas");
}
