import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readManifestInfo } from "./manifest-info.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

describe("readManifestInfo", () => {
  it("extracts version, CSP and permission lists from both shipped manifests", () => {
    for (const app of ["extension-firefox", "extension-chromium"]) {
      const manifest = JSON.parse(readFileSync(join(root, "apps", app, "manifest.json"), "utf8"));
      const info = readManifestInfo(() => manifest);
      expect(info, app).not.toBeNull();
      expect(info?.csp, app).toContain("connect-src 'none'");
      expect(info?.csp, app).toContain("script-src 'self'");
      expect(info?.permissions, app).toContain("storage");
      expect(info?.hostPermissions, app).toEqual(["<all_urls>"]);
    }
  });

  it("returns null instead of throwing when the manifest is unavailable or malformed", () => {
    expect(readManifestInfo()).toBeNull(); // no `browser` global under node
    expect(
      readManifestInfo(() => {
        throw new Error("no runtime");
      }),
    ).toBeNull();
    expect(readManifestInfo(() => null)).toBeNull();
    expect(readManifestInfo(() => ({ version: "1.0.0" }))).toBeNull();
    expect(readManifestInfo(() => ({ version: 1, content_security_policy: {} }))).toBeNull();
  });

  it("ignores non-string permission entries", () => {
    const info = readManifestInfo(() => ({
      version: "1.2.3",
      content_security_policy: { extension_pages: "connect-src 'none'" },
      permissions: ["storage", 5, null],
    }));
    expect(info).toEqual({
      version: "1.2.3",
      csp: "connect-src 'none'",
      permissions: ["storage"],
      hostPermissions: [],
    });
  });
});
