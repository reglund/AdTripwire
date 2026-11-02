import { describe, expect, it } from "vitest";
import {
  attachPassThroughInspector,
  type InspectionResult,
  type StreamFilterLike,
} from "./response-filter.js";

class FakeFilter implements StreamFilterLike {
  ondata: StreamFilterLike["ondata"] = null;
  onstart: StreamFilterLike["onstart"] = null;
  onstop: StreamFilterLike["onstop"] = null;
  onerror: StreamFilterLike["onerror"] = null;
  written: Uint8Array[] = [];
  disconnected = 0;
  closed = 0;
  error?: string;
  write(data: ArrayBuffer | Uint8Array): void {
    this.written.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }
  disconnect(): void {
    this.disconnected++;
  }
  close(): void {
    this.closed++;
  }
  feed(chunks: Uint8Array[]): void {
    for (const c of chunks)
      this.ondata?.({
        data: c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer,
      });
  }
}

const enc = new TextEncoder();
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function run(
  chunks: Uint8Array[],
  maxBytes: number,
  stopAfter = true,
): Promise<{ f: FakeFilter; r: InspectionResult }> {
  return new Promise((resolve) => {
    const f = new FakeFilter();
    attachPassThroughInspector(f, {
      maxBytes,
      analyzer: (text) => ({
        markers: text.includes("new Function") ? ["js.new_function"] : [],
        stats: { length: text.length, escapeRatio: 0, avgIdentifierLength: 0, stringLiterals: 0 },
      }),
      defer: (fn) => queueMicrotask(fn),
      onResult: (r) => resolve({ f, r }),
    });
    f.feed(chunks);
    if (stopAfter) f.onstop?.({});
  });
}

describe("attachPassThroughInspector", () => {
  it("passes every byte through unmodified and in order", async () => {
    const chunks = [
      enc.encode("var a = 1;"),
      enc.encode(" new Function('x')"),
      new Uint8Array([0, 255, 7]),
    ];
    const { f, r } = await run(chunks, 1024);
    expect(concat(f.written)).toEqual(concat(chunks));
    expect(r.inspection.observedBytes).toBe(concat(chunks).length);
    expect(r.inspection.truncated).toBe(false);
    expect(f.disconnected + f.closed).toBeGreaterThanOrEqual(1);
  });

  it("buffers only up to the cap, disconnects, and still passes the capped chunk through", async () => {
    const big = enc.encode("x".repeat(1000));
    const { f, r } = await run([big, big], 1500);
    // The second chunk arrives while under cap but exceeds it: fully written, partially buffered.
    expect(concat(f.written).length).toBe(2000);
    expect(r.inspection.truncated).toBe(true);
    expect(r.inspection.observedBytes).toBe(2000);
    expect(r.inspection.stats?.length).toBe(1500);
    expect(r.limitations).toContain("response_body_truncated");
    expect(f.disconnected).toBe(1);
  });

  it("reports zero bytes for an empty response", async () => {
    const { r } = await run([], 1024);
    expect(r.inspection.observedBytes).toBe(0);
    expect(r.inspection.markers).toEqual([]);
    expect(r.inspection.textDecodable).toBe(true);
  });

  it("finds markers via the analyzer and never returns source text", async () => {
    const { r } = await run([enc.encode("const f = new Function('return 1')")], 1024);
    expect(r.inspection.markers).toEqual(["js.new_function"]);
    expect(JSON.stringify(r)).not.toContain("return 1");
  });

  it("marks binary content as unsupported encoding", async () => {
    const bin = new Uint8Array(400);
    for (let i = 0; i < bin.length; i++) bin[i] = 0x80 + (i % 60); // invalid UTF-8 continuation bytes
    const { r } = await run([bin], 1024);
    expect(r.inspection.textDecodable).toBe(false);
    expect(r.limitations).toContain("response_body_unsupported_encoding");
  });

  it("releases the stream exactly once even if onstop fires after an error", async () => {
    const f = new FakeFilter();
    let results = 0;
    attachPassThroughInspector(f, {
      maxBytes: 10,
      analyzer: () => ({
        markers: [],
        stats: { length: 0, escapeRatio: 0, avgIdentifierLength: 0, stringLiterals: 0 },
      }),
      defer: (fn) => fn(),
      onResult: () => results++,
    });
    f.onerror?.({});
    f.onstop?.({});
    expect(f.disconnected + f.closed).toBe(1);
    expect(results).toBe(1);
  });

  it("survives an analyzer exception", async () => {
    const f = new FakeFilter();
    const r = await new Promise<InspectionResult>((resolve) => {
      attachPassThroughInspector(f, {
        maxBytes: 100,
        analyzer: () => {
          throw new Error("boom");
        },
        defer: (fn) => fn(),
        onResult: resolve,
      });
      f.feed([enc.encode("abc")]);
      f.onstop?.({});
    });
    expect(r.inspection.markers).toEqual([]);
    expect(concat(f.written)).toEqual(enc.encode("abc"));
  });
});
