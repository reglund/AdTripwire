/**
 * The published signed bundle in feeds/ must verify against the key pinned in the extension,
 * carry the same content as the built-in set, and be rejected as a replay of the built-in
 * version (a real update will carry a newer version).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_INDICATOR_SETS,
  canonicalJson,
  diffIndicatorSets,
  verifySignedBundle,
} from "@adtripwire/indicators";

const path = new URL("../../feeds/adtripwire-indicators-2026.11.02.signed.json", import.meta.url);
const bundle = JSON.parse(readFileSync(path, "utf8")) as { meta: { version: string } };
const builtIn = BUNDLED_INDICATOR_SETS[0]!;

describe("published signed indicator bundle", () => {
  it("verifies against the pinned project key", async () => {
    const r = await verifySignedBundle(bundle, { expectedSetId: builtIn.meta.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.key.keyId).toBe("adtripwire-2026a");
      expect(canonicalJson(r.bundle.payload)).toBe(canonicalJson(builtIn));
      expect(diffIndicatorSets(builtIn, r.bundle.payload).added).toEqual([]);
    }
  });

  it("is rejected as a replay when the built-in set has the same version", async () => {
    const r = await verifySignedBundle(bundle, {
      expectedSetId: builtIn.meta.id,
      activeVersion: builtIn.meta.version,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/not newer/);
  });

  it("is rejected after a single-byte change", async () => {
    const text = readFileSync(path, "utf8").replace('"enabled": true', '"enabled": false');
    const r = await verifySignedBundle(JSON.parse(text));
    expect(r.ok).toBe(false);
  });
});
