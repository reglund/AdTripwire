import { describe, expect, it, vi } from "vitest";
import { isLoopbackUrl, OllamaProvider, type FetchLike } from "./provider.js";
import type { AssistPackage } from "@adtripwire/shared";

const pkg: AssistPackage = {
  context: {
    language: "en",
    productVersion: "0",
    browser: "firefox",
    capabilities: [],
    generatedAt: 0,
    hostnames: [],
    referenceHostnames: [],
    detections: [],
    events: [],
    timeline: "",
    suggestedActions: [],
  },
  system: "sys",
  user: "usr",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("isLoopbackUrl", () => {
  it("accepts only plain loopback http URLs", () => {
    expect(isLoopbackUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLoopbackUrl("http://localhost:8787/")).toBe(false);
    expect(isLoopbackUrl("http://[::1]:11434")).toBe(false);
    expect(isLoopbackUrl("https://127.0.0.1:11434")).toBe(false);
    expect(isLoopbackUrl("http://10.0.0.1:11434")).toBe(false);
    expect(isLoopbackUrl("http://127.0.0.1.evil.example:11434")).toBe(false);
    expect(isLoopbackUrl("http://user:pw@127.0.0.1:11434")).toBe(false);
    expect(isLoopbackUrl("http://127.0.0.1:11434/v1")).toBe(false);
    expect(isLoopbackUrl("http://127.0.0.1:11434/?x=1")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });
});

describe("OllamaProvider", () => {
  it("rejects non-loopback endpoints and bad model names", () => {
    const fetchImpl: FetchLike = vi.fn();
    expect(
      () => new OllamaProvider({ baseUrl: "http://10.0.0.1:11434", model: "m", fetchImpl }),
    ).toThrow(/loopback/);
    expect(
      () =>
        new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "bad model;rm", fetchImpl }),
    ).toThrow(/model/);
  });

  it("probes /api/tags and lists valid model names", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("http://127.0.0.1:11434/api/tags");
      return jsonResponse({ models: [{ name: "qwen3:8b" }, { name: "bad name" }, { nope: 1 }] });
    });
    const p = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434/", model: "", fetchImpl });
    expect(await p.probe()).toEqual({ ok: true, models: ["qwen3:8b"] });
  });

  it("reports probe failures without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("NetworkError");
    });
    const p = new OllamaProvider({ baseUrl: "http://127.0.0.1:1", model: "", fetchImpl });
    const r = await p.probe();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/NetworkError/);
  });

  it("posts a deterministic chat request and returns message content", async () => {
    let sent: unknown;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ message: { role: "assistant", content: "hello" } });
    });
    const p = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen3:8b",
      fetchImpl,
      maxTokens: 100,
    });
    expect(await p.complete(pkg)).toBe("hello");
    expect(sent).toEqual({
      model: "qwen3:8b",
      stream: false,
      options: { temperature: 0, num_predict: 100 },
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
    });
  });

  it("refuses to complete without a model and rejects malformed answers", async () => {
    const p0 = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "",
      fetchImpl: vi.fn(),
    });
    await expect(p0.complete(pkg)).rejects.toThrow(/no model/);
    const p1 = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "m",
      fetchImpl: vi.fn(async () => new Response("not json", { status: 200 })),
    });
    await expect(p1.complete(pkg)).rejects.toThrow(/non-JSON/);
    const p2 = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "m",
      fetchImpl: vi.fn(async () => jsonResponse({ message: {} })),
    });
    await expect(p2.complete(pkg)).rejects.toThrow(/no message content/);
    const p3 = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "m",
      fetchImpl: vi.fn(async () => jsonResponse({}, 500)),
    });
    await expect(p3.complete(pkg)).rejects.toThrow(/HTTP 500/);
  });

  it("never follows redirects and rejects redirected responses", async () => {
    let init: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string, i?: RequestInit) => {
      init = i;
      const r = jsonResponse({ message: { content: "x" } });
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    });
    const p = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: "m", fetchImpl });
    await expect(p.complete(pkg)).rejects.toThrow(/redirected/);
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    expect(init?.cache).toBe("no-store");
    expect(init?.referrerPolicy).toBe("no-referrer");
  });

  it("caps the response body size", async () => {
    const big = JSON.stringify({ message: { content: "x".repeat(10_000) } });
    const p = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "m",
      fetchImpl: vi.fn(async () => new Response(big, { status: 200 })),
      maxResponseBytes: 1024,
    });
    await expect(p.complete(pkg)).rejects.toThrow(/too large/);
  });

  it("aborts on timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const p = new OllamaProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "m",
      fetchImpl,
      timeoutMs: 10,
    });
    await expect(p.complete(pkg)).rejects.toThrow(/aborted/);
  });
});
