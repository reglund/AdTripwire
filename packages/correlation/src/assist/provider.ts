/**
 * Provider abstraction for local-model completion. The only shipped implementation talks to
 * an Ollama-compatible `/api/chat` endpoint on loopback. The provider is given `fetch`
 * explicitly so it can be unit-tested and so the extension build without assistance has no
 * network code path at all.
 */
import type { AssistPackage } from "@adtripwire/shared";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProbeResult {
  ok: boolean;
  models: string[];
  error?: string;
}

export interface AssistProvider {
  readonly name: string;
  probe(): Promise<ProbeResult>;
  complete(pkg: AssistPackage): Promise<string>;
}

export interface OllamaProviderOptions {
  /** Loopback base URL, e.g. http://127.0.0.1:11434 (only 127.0.0.1 is accepted) */
  baseUrl: string;
  model: string;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  /** Cap on the raw response body read (bytes). */
  maxResponseBytes?: number;
  /** Cap on generated tokens (Ollama num_predict). */
  maxTokens?: number;
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export function isLoopbackUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  if (u.pathname !== "/" && u.pathname !== "") return false;
  if (u.search || u.hash) return false;
  // Exactly the origin the --assist CSP allows. "localhost" is excluded on purpose: it can be
  // redefined by the hosts file or resolve to a non-loopback address.
  return u.hostname === "127.0.0.1";
}

async function readCapped(res: Response, cap: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new Error("response too large");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    joined.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(joined);
}

export class OllamaProvider implements AssistProvider {
  readonly name = "ollama";
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxTokens: number;

  constructor(private readonly opts: OllamaProviderOptions) {
    if (!isLoopbackUrl(opts.baseUrl))
      throw new Error("assist endpoint must be a loopback http URL");
    if (opts.model !== "" && !MODEL_RE.test(opts.model)) throw new Error("invalid model name");
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 90_000;
    this.maxBytes = opts.maxResponseBytes ?? 256 * 1024;
    this.maxTokens = opts.maxTokens ?? 600;
  }

  private async request(path: string, init: RequestInit): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.opts.fetchImpl(`${this.base}${path}`, {
        ...init,
        signal: ctrl.signal,
        // A process on the chosen port must not be able to forward the evidence elsewhere.
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        mode: "cors",
      });
      if (res.redirected) throw new Error("runtime redirected the request");
      if (!res.ok) throw new Error(`runtime answered HTTP ${res.status}`);
      return await readCapped(res, this.maxBytes);
    } finally {
      clearTimeout(timer);
    }
  }

  async probe(): Promise<ProbeResult> {
    try {
      const body = JSON.parse(await this.request("/api/tags", { method: "GET" })) as unknown;
      const list = (body as { models?: unknown }).models;
      const models = Array.isArray(list)
        ? list
            .map((m) => (m && typeof m === "object" ? (m as { name?: unknown }).name : undefined))
            .filter((n): n is string => typeof n === "string" && MODEL_RE.test(n))
            .slice(0, 100)
        : [];
      return { ok: true, models };
    } catch (err) {
      return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async complete(pkg: AssistPackage): Promise<string> {
    if (this.opts.model === "") throw new Error("no model selected");
    const payload = {
      model: this.opts.model,
      stream: false,
      options: { temperature: 0, num_predict: this.maxTokens },
      messages: [
        { role: "system", content: pkg.system },
        { role: "user", content: pkg.user },
      ],
    };
    const text = await this.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("runtime returned non-JSON");
    }
    const content = (parsed as { message?: { content?: unknown } }).message?.content;
    if (typeof content !== "string") throw new Error("runtime response had no message content");
    return content;
  }
}
