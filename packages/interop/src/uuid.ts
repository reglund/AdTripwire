/**
 * Deterministic, name-based UUIDs (RFC 9562 version 5: SHA-1 over namespace + name).
 *
 * Used so that repeated STIX exports of the same data produce the same object ids. This is
 * NOT a security primitive: SHA-1 is used only because UUIDv5 is defined with it, and because
 * STIX 2.1 recommends UUIDv5 for cyber-observable ids. Pure TypeScript, synchronous, no deps.
 */

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** SHA-1 digest of a byte array (20 bytes). */
export function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length;
  const withPadding = ((ml + 9 + 63) >> 6) << 6;
  const msg = new Uint8Array(withPadding);
  msg.set(bytes);
  msg[ml] = 0x80;
  const view = new DataView(msg.buffer);
  const bitLen = ml * 8;
  view.setUint32(withPadding - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(withPadding - 4, bitLen >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < withPadding; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
  return out;
}

const HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuidBytes(uuid: string): Uint8Array {
  const u = uuid.toLowerCase();
  if (!HEX.test(u)) throw new Error(`invalid UUID: ${uuid}`);
  const hex = u.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** RFC 9562 UUIDv5 of `name` in `namespace` (a UUID string). */
export function uuidV5(namespace: string, name: string): string {
  const ns = uuidBytes(namespace);
  const nameBytes = utf8(name);
  const buf = new Uint8Array(ns.length + nameBytes.length);
  buf.set(ns);
  buf.set(nameBytes, ns.length);
  const h = sha1(buf).slice(0, 16);
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** STIX 2.1 namespace for deterministic SCO ids (STIX 2.1 §2.9). */
export const STIX_SCO_NAMESPACE = "00abedb4-aa42-466c-9c01-fed23315a9b7";

/** Namespace for AdTripwire SDO/SRO ids: uuidV5(DNS namespace, "adtripwire.stix.namespace"). */
export const ADTRIPWIRE_NAMESPACE = uuidV5(
  "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "adtripwire.stix.namespace",
);

/** Deterministic `type--uuid` id for an AdTripwire-produced SDO/SRO. */
export function stixId(type: string, name: string): string {
  return `${type}--${uuidV5(ADTRIPWIRE_NAMESPACE, `${type}:${name}`)}`;
}

/** STIX 2.1 deterministic SCO id from its id-contributing properties (canonical JSON). */
export function scoId(type: string, contributing: Record<string, string>): string {
  const keys = Object.keys(contributing).sort();
  const canonical =
    "{" +
    keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(contributing[k])}`).join(",") +
    "}";
  return `${type}--${uuidV5(STIX_SCO_NAMESPACE, canonical)}`;
}
