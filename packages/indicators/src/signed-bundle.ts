/**
 * Offline-verified, signed indicator bundles (Phase 6). A bundle replaces the built-in curated
 * set with the same id when its Ed25519 signature verifies against a pinned project key, its
 * SHA-256 matches, its version is newer than the active one and the payload passes the same
 * validation as every other indicator set. Bundles are files the person downloads and
 * imports; the extension never fetches them.
 */
import type { IndicatorClassification, IndicatorRecord, IndicatorSet } from "@adtripwire/shared";
import {
  base64ToBytes,
  bytesToHex,
  canonicalJson,
  toArrayBuffer,
  utf8Bytes,
} from "./canonical-json.js";
import { TRUSTED_SIGNING_KEYS, type TrustedSigningKey } from "./trusted-keys.js";
import { validateIndicatorSet } from "./validate.js";

export const SIGNED_BUNDLE_FORMAT = "adtripwire-signed-indicators/1";

export interface SignedBundleMeta {
  version: string;
  createdAt: string;
  keyId: string;
  /** Hex SHA-256 of the canonical JSON of `payload`. */
  sha256: string;
  changelog: string[];
}

export interface SignedBundle {
  format: typeof SIGNED_BUNDLE_FORMAT;
  meta: SignedBundleMeta;
  payload: IndicatorSet;
  /** Base64 Ed25519 signature over the canonical JSON of `{ meta, payload }`. */
  signature: string;
}

export interface IndicatorSetDiff {
  added: IndicatorRecord[];
  removed: IndicatorRecord[];
  reclassified: Array<{
    id: string;
    indicator: string;
    from: IndicatorClassification;
    to: IndicatorClassification;
  }>;
  validityChanged: Array<{ id: string; indicator: string; from: string; to: string }>;
  unchanged: number;
}

export type VerifyResult =
  { ok: true; bundle: SignedBundle; key: TrustedSigningKey } | { ok: false; errors: string[] };

export interface VerifyOptions {
  /** Version of the currently active set with the same id; the bundle must be newer. */
  activeVersion?: string;
  /** Id the bundle must carry (the built-in curated set it replaces). */
  expectedSetId?: string;
  keys?: readonly TrustedSigningKey[];
  subtle?: SubtleCrypto;
  now?: Date;
}

/** Dotted numeric versions ("2026.11.02", "2026.11.02.1"); -1, 0, 1. Non-numeric parts compare as strings. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The bytes a signature covers: canonical JSON of { meta, payload }. */
export function signedBytes(meta: SignedBundleMeta, payload: unknown): Uint8Array {
  return utf8Bytes(canonicalJson({ meta, payload }));
}

export async function sha256Hex(bytes: Uint8Array, subtle: SubtleCrypto): Promise<string> {
  return bytesToHex(await subtle.digest("SHA-256", toArrayBuffer(bytes)));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseMeta(raw: unknown, errors: string[]): SignedBundleMeta | null {
  if (!isObject(raw)) {
    errors.push("meta: must be an object");
    return null;
  }
  const before = errors.length;
  if (typeof raw["version"] !== "string" || !/^[0-9A-Za-z.-]{1,64}$/.test(raw["version"]))
    errors.push("meta.version: must match ^[0-9A-Za-z.-]{1,64}$");
  if (typeof raw["createdAt"] !== "string" || Number.isNaN(Date.parse(raw["createdAt"])))
    errors.push("meta.createdAt: must be an ISO timestamp");
  if (typeof raw["keyId"] !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(raw["keyId"]))
    errors.push("meta.keyId: invalid");
  if (typeof raw["sha256"] !== "string" || !/^[0-9a-f]{64}$/.test(raw["sha256"]))
    errors.push("meta.sha256: must be 64 lowercase hex characters");
  const changelog = raw["changelog"];
  if (
    !Array.isArray(changelog) ||
    changelog.length > 200 ||
    changelog.some((c) => typeof c !== "string" || c.length > 500)
  )
    errors.push("meta.changelog: must be an array of up to 200 strings (≤ 500 chars each)");
  if (errors.length > before) return null;
  return {
    version: raw["version"] as string,
    createdAt: raw["createdAt"] as string,
    keyId: raw["keyId"] as string,
    sha256: raw["sha256"] as string,
    changelog: changelog as string[],
  };
}

/**
 * Verifies a signed bundle. Every check runs before any trust is granted; errors are
 * collected so the person sees all problems at once. Never throws on bad input.
 */
export async function verifySignedBundle(
  raw: unknown,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const errors: string[] = [];
  const subtle = opts.subtle ?? globalThis.crypto?.subtle;
  if (!subtle)
    return { ok: false, errors: ["WebCrypto is not available; cannot verify signatures"] };
  if (!isObject(raw)) return { ok: false, errors: ["bundle: must be a JSON object"] };
  if (raw["format"] !== SIGNED_BUNDLE_FORMAT)
    errors.push(`format: expected "${SIGNED_BUNDLE_FORMAT}"`);
  const meta = parseMeta(raw["meta"], errors);
  if (typeof raw["signature"] !== "string") errors.push("signature: must be a base64 string");
  if (!isObject(raw["payload"])) errors.push("payload: must be an object");
  if (errors.length > 0 || !meta) return { ok: false, errors };

  const keys = opts.keys ?? TRUSTED_SIGNING_KEYS;
  const key = keys.find((k) => k.keyId === meta.keyId);
  if (!key) return { ok: false, errors: [`keyId ${meta.keyId} is not a trusted signing key`] };
  const now = opts.now ?? new Date();
  if (new Date(`${key.validFrom}T00:00:00Z`).getTime() > now.getTime())
    return { ok: false, errors: [`signing key ${key.keyId} is not yet valid`] };

  // 1. Signature over canonical { meta, payload }.
  const sig = base64ToBytes(raw["signature"] as string);
  const pub = base64ToBytes(key.publicKeyBase64);
  if (!sig || sig.length !== 64)
    return { ok: false, errors: ["signature: not a 64-byte Ed25519 signature"] };
  if (!pub || pub.length !== 32) return { ok: false, errors: ["trusted key is malformed"] };
  let verified: boolean;
  try {
    const cryptoKey = await subtle.importKey(
      "raw",
      toArrayBuffer(pub),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const data = signedBytes(meta, raw["payload"]);
    verified = await subtle.verify(
      { name: "Ed25519" },
      cryptoKey,
      toArrayBuffer(sig),
      toArrayBuffer(data),
    );
  } catch (err) {
    return {
      ok: false,
      errors: [
        `this browser could not verify an Ed25519 signature (${err instanceof Error ? err.message : String(err)}); update the browser`,
      ],
    };
  }
  if (!verified)
    return { ok: false, errors: ["signature does not verify against the trusted key"] };

  // 2. Hash of the payload (defence in depth; also what the release notes publish).
  const digest = await sha256Hex(utf8Bytes(canonicalJson(raw["payload"])), subtle);
  if (digest !== meta.sha256)
    return { ok: false, errors: ["meta.sha256 does not match the payload"] };

  // 3. Payload is a valid indicator set, not synthetic, same id, same version.
  const v = validateIndicatorSet(raw["payload"]);
  if (!v.ok) return { ok: false, errors: v.errors.map((e) => `payload: ${e}`) };
  if (v.set.meta.synthetic)
    return {
      ok: false,
      errors: ["payload: synthetic sets cannot be distributed as signed bundles"],
    };
  if (v.set.meta.version !== meta.version)
    return { ok: false, errors: ["payload.meta.version must equal meta.version"] };
  if (opts.expectedSetId !== undefined && v.set.meta.id !== opts.expectedSetId)
    return {
      ok: false,
      errors: [`payload.meta.id must be ${opts.expectedSetId}, got ${v.set.meta.id}`],
    };

  // 4. Monotonic version.
  if (opts.activeVersion !== undefined && compareVersions(meta.version, opts.activeVersion) <= 0)
    return {
      ok: false,
      errors: [
        `bundle version ${meta.version} is not newer than the active version ${opts.activeVersion}`,
      ],
    };

  const bundle: SignedBundle = {
    format: SIGNED_BUNDLE_FORMAT,
    meta,
    payload: v.set,
    signature: raw["signature"] as string,
  };
  return { ok: true, bundle, key };
}

/** What changes if `next` replaces `current`. Keyed by indicator value + type. */
export function diffIndicatorSets(current: IndicatorSet, next: IndicatorSet): IndicatorSetDiff {
  const key = (r: IndicatorRecord): string =>
    `${r.indicatorType}|${r.indicator}|${r.pathPattern ?? ""}`;
  const cur = new Map(current.indicators.map((r) => [key(r), r]));
  const nxt = new Map(next.indicators.map((r) => [key(r), r]));
  const diff: IndicatorSetDiff = {
    added: [],
    removed: [],
    reclassified: [],
    validityChanged: [],
    unchanged: 0,
  };
  for (const [k, r] of nxt) {
    const c = cur.get(k);
    if (!c) {
      diff.added.push(r);
      continue;
    }
    let changed = false;
    if (c.classification !== r.classification) {
      diff.reclassified.push({
        id: r.id,
        indicator: r.indicator,
        from: c.classification,
        to: r.classification,
      });
      changed = true;
    }
    const cv = `${c.validFrom ?? ""}..${c.validTo ?? ""}${c.enabled ? "" : " (disabled)"}`;
    const nv = `${r.validFrom ?? ""}..${r.validTo ?? ""}${r.enabled ? "" : " (disabled)"}`;
    if (cv !== nv) {
      diff.validityChanged.push({ id: r.id, indicator: r.indicator, from: cv, to: nv });
      changed = true;
    }
    if (!changed) diff.unchanged++;
  }
  for (const [k, r] of cur) if (!nxt.has(k)) diff.removed.push(r);
  return diff;
}
