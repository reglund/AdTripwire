/**
 * Reads the installed extension manifest at runtime so the "Check this yourself" card shows what
 * the browser actually loaded, not a copy baked into the bundle. Never throws: when the manifest
 * cannot be read (unit tests, unexpected shape) the result is null and the card says so.
 */
export interface ManifestInfo {
  version: string;
  csp: string;
  permissions: string[];
  hostPermissions: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function readManifestInfo(
  read: () => unknown = () => browser.runtime.getManifest(),
): ManifestInfo | null {
  try {
    const m = read();
    if (typeof m !== "object" || m === null) return null;
    const rec = m as Record<string, unknown>;
    if (typeof rec["version"] !== "string") return null;
    const cspField = rec["content_security_policy"];
    const csp =
      typeof cspField === "string"
        ? cspField
        : typeof cspField === "object" && cspField !== null
          ? (cspField as Record<string, unknown>)["extension_pages"]
          : undefined;
    if (typeof csp !== "string") return null;
    return {
      version: rec["version"],
      csp,
      permissions: strings(rec["permissions"]),
      hostPermissions: strings(rec["host_permissions"]),
    };
  } catch {
    return null;
  }
}
