/**
 * Minimal deterministic ZIP writer (no dependencies). Entries are sorted by path, timestamps
 * are fixed to 1980-01-01 00:00:00, no extra fields, no external attributes, deflate level 9.
 * Two runs over identical file contents produce identical bytes.
 */
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0x0000; // 00:00:00
const DOS_DATE = 0x0021; // 1980-01-01

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

/** @param {Array<{path: string, data: Buffer}>} entries */
export function buildZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of sorted) {
    const name = Buffer.from(e.path, "utf8");
    const crc = crc32(e.data);
    const deflated = deflateRawSync(e.data, { level: 9 });
    const store = deflated.length >= e.data.length;
    const body = store ? e.data : deflated;
    const method = store ? 0 : 8;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(method),
      u16(DOS_TIME),
      u16(DOS_DATE),
      u32(crc),
      u32(body.length),
      u32(e.data.length),
      u16(name.length),
      u16(0),
      name,
      body,
    ]);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(method),
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(body.length),
        u32(e.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(sorted.length),
    u16(sorted.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, central, end]);
}
