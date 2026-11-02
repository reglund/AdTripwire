/**
 * The newest published signed bundle in feeds/ must verify against the key pinned in the
 * extension. When its version equals the built-in set's, the content must be identical; when
 * the built-in set is newer (an automated indicator refresh merged, bundle not yet signed),
 * the bundle must still be older, never newer, than what ships.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_INDICATOR_SETS,
  canonicalJson,
  compareVersions,
  verifySignedBundle,
} from "@adtripwire/indicators";

const feedsDir = new URL("../../feeds/", import.meta.url);
const newest = readdirSync(feedsDir)
  .filter((f) => /^adtripwire-indicators-[\d.]+\.signed\.json$/.test(f))
  .sort((a, b) =>
    compareVersions(
      a.replace(/^adtripwire-indicators-|\.signed\.json$/g, ""),
      b.replace(/^adtripwire-indicators-|\.signed\.json$/g, ""),
    ),
  )
  .pop();
const path = new URL(newest ?? "missing", feedsDir);
const text = readFileSync(path, "utf8");
const bundle = JSON.parse(text) as { meta: { version: string } };
const builtIn = BUNDLED_INDICATOR_SETS[0]!;

describe("published signed indicator bundle", () => {
  it("exists", () => {
    expect(newest).toBeDefined();
  });

  it("verifies against the pinned project key and matches or trails the built-in set", async () => {
    const r = await verifySignedBundle(bundle, { expectedSetId: builtIn.meta.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.key.keyId).toBe("adtripwire-2026a");
    const cmp = compareVersions(r.bundle.meta.version, builtIn.meta.version);
    expect(cmp).toBeLessThanOrEqual(0);
    if (cmp === 0) expect(canonicalJson(r.bundle.payload)).toBe(canonicalJson(builtIn));
  });

  it("is rejected as a replay when it is not newer than the built-in set", async () => {
    const r = await verifySignedBundle(bundle, {
      expectedSetId: builtIn.meta.id,
      activeVersion: builtIn.meta.version,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/not newer/);
  });

  it("is rejected after a single-byte change", async () => {
    const r = await verifySignedBundle(
      JSON.parse(text.replace('"enabled": true', '"enabled": false')),
    );
    expect(r.ok).toBe(false);
  });
});
