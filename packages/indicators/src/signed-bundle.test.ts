import { describe, expect, it, beforeAll } from "vitest";
import type { IndicatorSet } from "@adtripwire/shared";
import {
  canonicalJson,
  bytesToBase64,
  bytesToHex,
  base64ToBytes,
  utf8Bytes,
} from "./canonical-json.js";
import {
  compareVersions,
  diffIndicatorSets,
  SIGNED_BUNDLE_FORMAT,
  signedBytes,
  sha256Hex,
  verifySignedBundle,
  type SignedBundleMeta,
} from "./signed-bundle.js";
import type { TrustedSigningKey } from "./trusted-keys.js";
import { TRUSTED_SIGNING_KEYS } from "./trusted-keys.js";
import { validateIndicatorSet } from "./validate.js";
import adfection from "../data/adfection-2026.json";

const subtle = globalThis.crypto.subtle;
let keyPair: CryptoKeyPair;
let trusted: TrustedSigningKey;

const base = (() => {
  const v = validateIndicatorSet(adfection);
  if (!v.ok) throw new Error("bundled set invalid");
  return v.set as IndicatorSet;
})();

async function sign(
  payload: unknown,
  metaOverride: Partial<SignedBundleMeta> = {},
  key = keyPair.privateKey,
) {
  const digest = await sha256Hex(utf8Bytes(canonicalJson(payload)), subtle);
  const meta: SignedBundleMeta = {
    version: (payload as IndicatorSet).meta.version,
    createdAt: "2026-11-03T10:00:00Z",
    keyId: trusted.keyId,
    sha256: digest,
    changelog: ["test bundle"],
    ...metaOverride,
  };
  const sig = await subtle.sign({ name: "Ed25519" }, key, signedBytes(meta, payload));
  return {
    format: SIGNED_BUNDLE_FORMAT,
    meta,
    payload,
    signature: bytesToBase64(new Uint8Array(sig)),
  };
}

function newer(): IndicatorSet {
  return { ...base, meta: { ...base.meta, version: "2026.12.01" } };
}

beforeAll(async () => {
  keyPair = (await subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey));
  trusted = {
    keyId: "test-key",
    algorithm: "Ed25519",
    publicKeyBase64: bytesToBase64(raw),
    validFrom: "2026-01-01",
    note: "test",
  };
});

describe("canonicalJson", () => {
  it("sorts keys recursively, drops undefined and has no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, "x"], c: true, u: undefined } })).toBe(
      '{"a":{"c":true,"d":[1,"x"]},"b":1}',
    );
  });
  it("rejects non-plain values", () => {
    expect(() => canonicalJson(new Date())).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
  it("round-trips base64 and hex helpers", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(bytesToHex(bytes)).toBe("000102faff");
    expect(base64ToBytes("not base64!")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares dotted numeric versions", () => {
    expect(compareVersions("2026.11.02", "2026.11.02")).toBe(0);
    expect(compareVersions("2026.11.02", "2026.11.03")).toBe(-1);
    expect(compareVersions("2026.11.02.1", "2026.11.02")).toBe(1);
    expect(compareVersions("2026.9.1", "2026.10.1")).toBe(-1);
    expect(compareVersions("2027.1", "2026.12.31")).toBe(1);
  });
});

describe("verifySignedBundle", () => {
  it("accepts a correctly signed, newer bundle", async () => {
    const b = await sign(newer());
    const r = await verifySignedBundle(b, {
      keys: [trusted],
      activeVersion: base.meta.version,
      expectedSetId: base.meta.id,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.key.keyId).toBe("test-key");
      expect(r.bundle.payload.indicators.length).toBe(base.indicators.length);
    }
  });

  it("rejects a bundle whose payload was altered after signing", async () => {
    const b = await sign(newer());
    (b.payload as IndicatorSet).indicators[0]!.classification = "malicious";
    const r = await verifySignedBundle(b, { keys: [trusted] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/signature does not verify/);
  });

  it("rejects a tampered meta (version bump without re-signing)", async () => {
    const b = await sign(newer());
    b.meta.version = "2027.01.01";
    const r = await verifySignedBundle(b, { keys: [trusted] });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown keys, not-yet-valid keys and the wrong format", async () => {
    const b = await sign(newer());
    expect((await verifySignedBundle(b, { keys: [] })).ok).toBe(false);
    expect(
      (await verifySignedBundle(b, { keys: [{ ...trusted, validFrom: "2099-01-01" }] })).ok,
    ).toBe(false);
    expect((await verifySignedBundle({ ...b, format: "other" }, { keys: [trusted] })).ok).toBe(
      false,
    );
  });

  it("rejects a bundle signed by a different key under a trusted key id", async () => {
    const other = (await subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const b = await sign(newer(), {}, other.privateKey);
    const r = await verifySignedBundle(b, { keys: [trusted] });
    expect(r.ok).toBe(false);
  });

  it("rejects replays and wrong set ids", async () => {
    const same = await sign(base);
    const r1 = await verifySignedBundle(same, {
      keys: [trusted],
      activeVersion: base.meta.version,
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors[0]).toMatch(/not newer/);
    const r2 = await verifySignedBundle(await sign(newer()), {
      keys: [trusted],
      expectedSetId: "other-set",
    });
    expect(r2.ok).toBe(false);
  });

  it("rejects a mismatched sha256 and a version mismatch between meta and payload", async () => {
    const b = await sign(newer(), { sha256: "0".repeat(64) });
    expect((await verifySignedBundle(b, { keys: [trusted] })).ok).toBe(false);
    const c = await sign(newer(), { version: "2026.12.02" });
    const r = await verifySignedBundle(c, { keys: [trusted] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/payload.meta.version/);
  });

  it("rejects a synthetic payload and an invalid payload", async () => {
    const syn = { ...newer(), meta: { ...newer().meta, synthetic: true } };
    expect((await verifySignedBundle(await sign(syn), { keys: [trusted] })).ok).toBe(false);
    const bad = { ...newer(), indicators: [{ id: "x" }] };
    expect((await verifySignedBundle(await sign(bad), { keys: [trusted] })).ok).toBe(false);
  });

  it("never throws on garbage", async () => {
    for (const g of [
      null,
      1,
      "x",
      [],
      {},
      { format: SIGNED_BUNDLE_FORMAT, meta: 1 },
      { format: SIGNED_BUNDLE_FORMAT, meta: {}, payload: {}, signature: 5 },
    ]) {
      const r = await verifySignedBundle(g, { keys: [trusted] });
      expect(r.ok).toBe(false);
    }
  });

  it("ships a well-formed project key", () => {
    expect(TRUSTED_SIGNING_KEYS.length).toBeGreaterThan(0);
    for (const k of TRUSTED_SIGNING_KEYS) expect(base64ToBytes(k.publicKeyBase64)?.length).toBe(32);
  });
});

describe("diffIndicatorSets", () => {
  it("reports added, removed, reclassified and validity changes", () => {
    const next = newer();
    const [first, second, ...rest] = next.indicators;
    const changed = {
      ...first!,
      classification: first!.classification === "malicious" ? "contextual" : "malicious",
    } as typeof first;
    const validity = { ...second!, validTo: "2027-01-01" };
    next.indicators = [
      changed!,
      validity,
      ...rest,
      { ...first!, id: "new-1", indicator: "new.example", indicatorType: "hostname" },
    ];
    const d = diffIndicatorSets(base, next);
    expect(d.added.map((r) => r.indicator)).toEqual(["new.example"]);
    expect(d.removed).toEqual([]);
    expect(d.reclassified).toHaveLength(1);
    expect(d.validityChanged).toHaveLength(1);
    expect(d.unchanged).toBe(base.indicators.length - 2);
    const back = diffIndicatorSets(next, base);
    expect(back.removed.map((r) => r.indicator)).toEqual(["new.example"]);
  });
});
