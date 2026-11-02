/**
 * Minimal PNG writer (no dependencies) producing the AdTripwire icon: a neutral horizontal
 * wire between two posts with an amber trigger dot, on a transparent background. Chromium
 * requires raster icons; Firefox uses the SVGs in public/icons.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

export function renderIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  const s = size / 48;
  const post = (cx) => {
    for (let y = Math.round(10 * s); y < Math.round(38 * s); y++)
      for (let x = Math.round(cx - 2 * s); x <= Math.round(cx + 2 * s); x++) set(x, y, 52, 64, 84);
  };
  post(10 * s);
  post(38 * s);
  for (let x = Math.round(12 * s); x <= Math.round(36 * s); x++)
    for (let y = Math.round(23 * s); y <= Math.round(24.5 * s); y++) set(x, y, 90, 104, 128);
  const cx = 24 * s;
  const cy = 24 * s;
  const rad = 4.5 * s;
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++)
    for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= rad) set(x, y, 214, 143, 32, d > rad - 1 ? 180 : 255);
    }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function writeIcons(dir) {
  mkdirSync(dir, { recursive: true });
  for (const size of [48, 96, 128]) writeFileSync(join(dir, `icon-${size}.png`), renderIcon(size));
}
