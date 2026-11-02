/**
 * DEV-only self-test for the loopback assist path. Opened automatically by DEV builds made
 * with --assist, it probes the fixture server's mock runtime on 127.0.0.1 (port 8787 for the
 * Firefox harness, 8788 for the Chromium harness; the first that answers is used), sends a
 * canned package, screens the canned answer and reports the result on the console so the
 * browser-level test can assert CSP, CORS, fetch, JSON parsing and guardrails together.
 * Never bundled into production: both flags must be true.
 */
import type { AssistContext } from "@adtripwire/shared";
import { OllamaProvider, renderPrompt, screenAssistOutput } from "@adtripwire/correlation";
import { h } from "../dom.js";
import { renderScreened } from "./panel.js";

const CANNED: AssistContext = {
  language: "en",
  productVersion: "selftest",
  browser: "unknown",
  capabilities: ["request_metadata"],
  generatedAt: 0,
  hostnames: ["noas.synthetic-adfection.test", "publisher.synthetic-site.test"],
  referenceHostnames: [],
  detections: [
    {
      ruleId: "known_infra.surveillance_contact",
      ruleName: "Contact with documented surveillance infrastructure",
      category: "known_infrastructure",
      severity: "elevated",
      confidence: "high",
      confidenceRationale: "exact hostname match",
      summary: "A request reached a documented host.",
      significance: "Documented ad-delivery path.",
      observed: ["Request to noas.synthetic-adfection.test"],
      alternativeExplanations: [],
      missingVisibility: [],
      subjectHostnames: ["noas.synthetic-adfection.test"],
      matchedIndicatorIds: ["synthetic-1"],
      offsetSeconds: 0,
    },
  ],
  events: [],
  timeline: "One request observed.",
  suggestedActions: ["Export a hand-off package."],
};

export async function runAssistSelfTest(): Promise<HTMLElement> {
  const lines: string[] = [];
  const out = h("div", { class: "view" }, h("h2", null, "Assist self-test (DEV build)"));
  try {
    let provider: OllamaProvider | null = null;
    let probe: Awaited<ReturnType<OllamaProvider["probe"]>> = { ok: false, models: [] };
    for (const port of [8787, 8788]) {
      const candidate = new OllamaProvider({
        baseUrl: `http://127.0.0.1:${port}`,
        model: "mock-model",
        fetchImpl: (url, init) => fetch(url, init),
        timeoutMs: 10_000,
      });
      probe = await candidate.probe();
      provider = candidate;
      if (probe.ok) break;
    }
    if (!provider) throw new Error("no provider");
    lines.push(
      `[AdTripwire] assist selftest probe ${probe.ok ? "ok" : "failed"} models=${probe.models.join(",")}${probe.error ? ` error=${probe.error}` : ""}`,
    );
    const pkg = renderPrompt(CANNED);
    const raw = await provider.complete(pkg);
    const screened = screenAssistOutput(raw, pkg.context);
    lines.push(
      `[AdTripwire] assist selftest flags=${[...screened.flags].sort().join(",")} removed=${screened.removedSentences} masked=${screened.maskedHostnames}`,
    );
    out.appendChild(renderScreened(screened));
  } catch (err) {
    lines.push(
      `[AdTripwire] assist selftest error ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  for (const l of lines) {
    console.info(l);
    out.appendChild(h("p", { class: "mono small" }, l));
  }
  return out;
}
