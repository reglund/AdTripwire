import type {
  NormalizedEvent,
  ObservationLimitation,
  ResponseInspection,
} from "@adtripwire/shared";
import { newId } from "@adtripwire/shared";

/** Minimal structural type for Firefox's StreamFilter so this module is testable in Node. */
export interface StreamFilterLike {
  ondata: ((event: { data: ArrayBuffer }) => void) | null;
  onstart: ((event: unknown) => void) | null;
  onstop: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  write(data: ArrayBuffer | Uint8Array): void;
  disconnect(): void;
  close(): void;
  readonly error?: string;
  readonly status?: string;
}

export type JsAnalyzer = (text: string) => {
  markers: string[];
  stats: ResponseInspection["stats"];
};

export interface InspectionResult {
  inspection: ResponseInspection;
  limitations: ObservationLimitation[];
  /** Milliseconds spent inside filter callbacks (pass-through cost), not including deferred analysis. */
  passThroughMs: number;
  analysisMs: number;
}

export interface AttachOptions {
  maxBytes: number;
  analyzer: JsAnalyzer;
  contentType?: string;
  /** Receives the result once the stream has finished and analysis has run (off the response path). */
  onResult: (result: InspectionResult) => void;
  onLog?: (level: "warn" | "error", msg: string) => void;
  now?: () => number;
  /** Defer function for off-path analysis; defaults to setTimeout(fn, 0). */
  defer?: (fn: () => void) => void;
}

/**
 * Attaches a byte-for-byte pass-through filter that buffers at most `maxBytes` of the
 * response for later analysis. Invariants:
 *  - every chunk is written downstream immediately and unmodified;
 *  - buffering stops at the cap, and the filter disconnects so Firefox streams the rest natively;
 *  - the stream is always released (disconnect/close) on stop and on error;
 *  - analysis runs deferred, never inside a filter callback.
 */
export function attachPassThroughInspector(filter: StreamFilterLike, opts: AttachOptions): void {
  const now = opts.now ?? (() => performance.now());
  const defer = opts.defer ?? ((fn) => setTimeout(fn, 0));
  const chunks: Uint8Array[] = [];
  let buffered = 0;
  let observed = 0;
  let truncated = false;
  let released = false;
  let passThroughMs = 0;
  let finished = false;

  const release = (how: "disconnect" | "close") => {
    if (released) return;
    released = true;
    try {
      if (how === "disconnect") filter.disconnect();
      else filter.close();
    } catch (e) {
      opts.onLog?.("warn", `stream release failed: ${String(e)}`);
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    const capturedChunks = chunks.splice(0);
    const capturedObserved = observed;
    const capturedTruncated = truncated;
    const capturedBuffered = buffered;
    defer(() => {
      const t0 = now();
      const limitations: ObservationLimitation[] = [];
      // An empty body is trivially decodable text.
      let text: string | null = capturedBuffered === 0 ? "" : null;
      if (capturedBuffered > 0) {
        const merged = new Uint8Array(capturedBuffered);
        let off = 0;
        for (const c of capturedChunks) {
          merged.set(c, off);
          off += c.length;
        }
        try {
          text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
          // Heuristic: if a large share decoded to U+FFFD, treat as binary/unsupported.
          const bad = (text.match(/�/g) ?? []).length;
          if (text.length > 0 && bad / text.length > 0.05) {
            text = null;
            limitations.push("response_body_unsupported_encoding");
          }
        } catch {
          text = null;
          limitations.push("response_body_unsupported_encoding");
        }
      }
      if (capturedTruncated) limitations.push("response_body_truncated");
      let markers: string[] = [];
      let stats: ResponseInspection["stats"] | undefined;
      if (text !== null && text.length > 0) {
        try {
          const r = opts.analyzer(text);
          markers = r.markers;
          stats = r.stats;
        } catch (e) {
          opts.onLog?.("error", `analyzer failed: ${String(e)}`);
        }
      }
      const inspection: ResponseInspection = {
        observedBytes: capturedObserved,
        truncated: capturedTruncated,
        textDecodable: text !== null,
        markers,
      };
      if (opts.contentType) inspection.contentType = opts.contentType;
      if (stats) inspection.stats = stats;
      opts.onResult({ inspection, limitations, passThroughMs, analysisMs: now() - t0 });
    });
  };

  filter.ondata = (event) => {
    const t0 = now();
    try {
      // 1. Pass through first, unmodified. The page must never wait on analysis.
      filter.write(event.data);
      const len = event.data.byteLength;
      observed += len;
      // 2. Buffer up to the cap.
      if (!truncated) {
        if (buffered + len <= opts.maxBytes) {
          chunks.push(new Uint8Array(event.data.slice(0)));
          buffered += len;
        } else {
          const room = opts.maxBytes - buffered;
          if (room > 0) {
            chunks.push(new Uint8Array(event.data.slice(0, room)));
            buffered += room;
          }
          truncated = true;
          // Let Firefox stream the remainder natively; we stop receiving callbacks.
          release("disconnect");
          finish();
        }
      }
    } catch (e) {
      opts.onLog?.("error", `ondata failed: ${String(e)}`);
      release("disconnect");
      finish();
    } finally {
      passThroughMs += now() - t0;
    }
  };

  filter.onstop = () => {
    const t0 = now();
    release("disconnect");
    passThroughMs += now() - t0;
    finish();
  };

  filter.onerror = () => {
    opts.onLog?.("warn", `stream filter error: ${filter.error ?? "unknown"}`);
    release("disconnect");
    finish();
  };
}

/** Builds the response_inspected event that follows a request's completion. */
export function buildInspectionEvent(
  base: NormalizedEvent,
  result: InspectionResult,
  timestamp: number,
): NormalizedEvent {
  const ev: NormalizedEvent = {
    ...base,
    eventId: newId(),
    timestamp,
    sensor: "response-filter",
    eventType: "response_inspected",
    requestStatus: "completed",
    responseInspection: result.inspection,
    matchedIndicators: [],
    matchedRules: [],
    evidenceQuality: result.inspection.truncated ? "partial" : "direct",
    observationLimitations: Array.from(
      new Set([...base.observationLimitations, ...result.limitations]),
    ),
  };
  return ev;
}
