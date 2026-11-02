/**
 * Single entry point to the background sensor. Everything the UI shows comes through here;
 * the UI never fabricates data. Failures (including an unreachable background) surface as
 * thrown Errors so each page can render an explicit error state.
 */
import type { UiRequest, UiResponse } from "@adtripwire/shared";

function isUiResponse(value: unknown): value is UiResponse {
  if (typeof value !== "object" || value === null) return false;
  const ok = (value as { ok?: unknown }).ok;
  return ok === true || ok === false;
}

export async function rpc<T>(req: UiRequest): Promise<T> {
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(req);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`The AdTripwire background service could not be reached (${detail}).`, {
      cause: err,
    });
  }
  if (!isUiResponse(response)) {
    throw new Error("The AdTripwire background service returned an unexpected response.");
  }
  if (!response.ok) throw new Error(response.error);
  return response.data as T;
}

/**
 * Host permission must be requested from a user-gesture handler in the page itself;
 * a message hop to the background does not carry the gesture in Firefox.
 */
export async function requestHostPermission(): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: ["<all_urls>"] });
  } catch {
    return false;
  }
}
