#!/usr/bin/env node
/**
 * Maintainer tooling for signed indicator bundles (Phase 6). Private keys live outside the
 * repository; the extension pins only public keys (packages/indicators/src/trusted-keys.ts).
 *
 *   node scripts/sign-indicators.mjs keygen --key-id adtripwire-2026a --dir ~/.config/adtripwire/signing
 *   node scripts/sign-indicators.mjs sign   --key ~/.config/adtripwire/signing/adtripwire-2026a.private.pem \
 *        --key-id adtripwire-2026a [--in packages/indicators/data/adfection-2026.json] \
 *        [--changelog "text" ...] [--out feeds/adtripwire-indicators-<version>.signed.json]
 *   node scripts/sign-indicators.mjs verify --in feeds/adtripwire-indicators-<version>.signed.json
 *
 * The signature covers canonical JSON of { meta, payload } (same code path as the extension).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
} from "node:crypto";
import {
  canonicalJson,
  utf8Bytes,
  bytesToBase64,
  bytesToHex,
} from "../packages/indicators/src/canonical-json.ts";
import {
  verifySignedBundle,
  SIGNED_BUNDLE_FORMAT,
} from "../packages/indicators/src/signed-bundle.ts";
import { validateIndicatorSet } from "../packages/indicators/src/validate.ts";

const [cmd, ...rest] = process.argv.slice(2);
function arg(name, def) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : def;
}
function args(name) {
  const out = [];
  rest.forEach((a, i) => {
    if (a === `--${name}` && rest[i + 1] !== undefined) out.push(rest[i + 1]);
  });
  return out;
}
const expand = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

if (cmd === "keygen") {
  const keyId = arg("key-id");
  const dir = expand(arg("dir", "~/.config/adtripwire/signing"));
  if (!keyId) throw new Error("--key-id required");
  mkdirSync(dir, { recursive: true });
  const priv = join(dir, `${keyId}.private.pem`);
  if (existsSync(priv)) throw new Error(`${priv} exists; refusing to overwrite`);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  writeFileSync(
    join(dir, `${keyId}.public.pem`),
    publicKey.export({ type: "spki", format: "pem" }),
  );
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  console.log(`private key: ${priv}`);
  console.log(
    `add to trusted-keys.ts: keyId "${keyId}", publicKeyBase64 "${raw.toString("base64")}"`,
  );
} else if (cmd === "sign") {
  const keyPath = expand(arg("key", ""));
  const keyId = arg("key-id");
  const input = arg("in", "packages/indicators/data/adfection-2026.json");
  if (!keyPath || !keyId) throw new Error("--key and --key-id required");
  const payloadRaw = JSON.parse(readFileSync(input, "utf8"));
  const v = validateIndicatorSet(payloadRaw);
  if (!v.ok) throw new Error(`payload invalid:\n${v.errors.join("\n")}`);
  if (v.set.meta.synthetic) throw new Error("refusing to sign a synthetic set");
  const payload = payloadRaw;
  const canonicalPayload = canonicalJson(payload);
  const sha256 = bytesToHex(
    await globalThis.crypto.subtle.digest("SHA-256", utf8Bytes(canonicalPayload)),
  );
  const meta = {
    version: v.set.meta.version,
    createdAt: new Date().toISOString(),
    keyId,
    sha256,
    changelog: args("changelog"),
  };
  const privateKey = createPrivateKey(readFileSync(keyPath));
  const signature = nodeSign(null, utf8Bytes(canonicalJson({ meta, payload })), privateKey);
  const bundle = {
    format: SIGNED_BUNDLE_FORMAT,
    meta,
    payload,
    signature: bytesToBase64(new Uint8Array(signature)),
  };
  // Self-check with the extension's verifier against the key we just used.
  const pubRaw = createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32);
  const check = await verifySignedBundle(bundle, {
    keys: [
      {
        keyId,
        algorithm: "Ed25519",
        publicKeyBase64: pubRaw.toString("base64"),
        validFrom: "2000-01-01",
        note: "self-check",
      },
    ],
  });
  if (!check.ok) throw new Error(`self-check failed: ${check.errors.join("; ")}`);
  const out = arg("out", `feeds/adtripwire-indicators-${meta.version}.signed.json`);
  writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n");
  console.log(
    `signed bundle ${meta.version} (${v.set.indicators.length} indicators, sha256 ${sha256}) → ${out}`,
  );
} else if (cmd === "verify") {
  const input = arg("in");
  if (!input) throw new Error("--in required");
  const r = await verifySignedBundle(JSON.parse(readFileSync(input, "utf8")));
  if (!r.ok) {
    console.error(`INVALID: ${r.errors.join("; ")}`);
    process.exit(1);
  }
  console.log(
    `valid: version ${r.bundle.meta.version}, key ${r.key.keyId}, ${r.bundle.payload.indicators.length} indicators, sha256 ${r.bundle.meta.sha256}`,
  );
} else {
  console.error("usage: sign-indicators.mjs keygen|sign|verify …");
  process.exit(2);
}
