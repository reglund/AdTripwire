# Local model assistance (Phase 5, optional)

AdTripwire's detections are produced by deterministic rules and carry their own evidence,
alternative explanations and suggested steps. Phase 5 adds two layers on top of them:

1. **Deterministic correlation** (always present): detections are grouped into _related
   activity_ when they cite the same request, matched the same indicator, name the same
   hostname or registrable domain, or occurred in the same tab within the correlation
   window. Each group gets a templated summary, a timeline narrative and suggested
   investigative actions derived from the group's shape and the sensor's capabilities.
   Nothing here is inferred by a model; it is a different view of stored detections.
2. **Local model assistance** (optional, separate build): a local language model can
   turn the evidence of one detection or group into a plain-language explanation. The
   model's words are interpretation, never evidence.

## What the default build does and does not do

The standard build has **no network capability at all**: its content security policy sets
`connect-src 'none'` and the bundle contains no code path that could open a connection.
The build guard fails if a loopback model call survives in a non-assist bundle. The
dashboard's assistance panels explain that the feature is not included.

## The `--assist` build

```bash
node apps/extension-firefox/build.mjs --assist     # or apps/extension-chromium
```

Differences from the default build:

- The extension-page CSP becomes `connect-src http://127.0.0.1:*`.
  No other origin is reachable; the guard checks the built manifest.
- The settings page gains "Local model assistance (optional)" with an explicit opt-in,
  the loopback port, a model chooser populated from the runtime, and the answer language
  (English or Norwegian bokmål).
- Detection detail and related-activity pages gain a panel with two buttons: **Preview
  what would be sent** and **Ask local model to explain**.
- The manifest name carries "(local assist build)" so the variant is visible.

The runtime must be Ollama-compatible (`GET /api/tags`, `POST /api/chat`) and listen on
127.0.0.1 (`localhost` is deliberately not accepted: it can be redefined by the hosts
file). Ollama's defaults already allow extension origins for CORS. A model on another
machine can be used through an SSH port forward; the extension itself never addresses
anything but loopback, the provider refuses any other base URL, never follows redirects
(`redirect: "error"`), sends no credentials and no referrer, and the sensor ignores requests
issued by extension pages so a model call can never become an observed event.

## What is sent

Only the `AssistContext` built by `buildAssistContext` in `@adtripwire/correlation`:

- sanitized hostnames and path patterns of the supporting events (re-validated against the
  hostname grammar; path patterns reduced to a conservative character set, ≤ 80 chars);
- rule ids, names, severity and confidence labels, the rule's own summary, significance,
  evidence sentences, benign explanations and missing-visibility notes (each capped);
- the deterministic timeline narrative and suggested actions;
- browser name and capability list; product version.

Never sent: analyst notes, cookie values, query values, full URLs, page content, tab ids,
detection or event ids, timestamps other than relative offsets. The preview shows the
exact text.

## Guardrails

The design assumes a weak or hostile model and attacker-influenced input (hostnames and
paths are chosen by the ad path). The product guarantee rests on the deterministic layer,
not on model quality:

| Guardrail                      | Mechanism                                                                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model cannot change detections | Output is text displayed in the page; it is never stored, exported or fed back into the engine. Severity, confidence and evidence shown next to it come from the detection.                                                            |
| No verdicts                    | Sentences asserting that the device/person is infected, compromised, hacked, spied on, or safe/clean/not infected are removed (English and Norwegian patterns) and the removal is shown. Hedged caveats ("cannot show whether…") stay. |
| No invented infrastructure     | Hostname-like tokens not present in the evidence (or its source references) are replaced with "[hostname not in evidence]".                                                                                                            |
| Prompt injection               | Evidence is fenced as data; hostnames/paths are re-sanitized; instruction-like echoes are flagged; an injection scenario is part of the evaluation.                                                                                    |
| No links                       | URLs are shown as plain text with the scheme stripped and flagged; the UI never creates anchors from model text.                                                                                                                       |
| Priority inflation             | "critical / emergency / high priority" in the answer is flagged when no detection is high priority.                                                                                                                                    |
| Bounded                        | Output capped at 3 000 characters; runtime response body capped at 256 KB; 90 s timeout; temperature 0; `num_predict` 600.                                                                                                             |
| Labelled                       | Every answer starts with "Interpretation generated by a local model. It is not evidence and does not change any detection."                                                                                                            |

Screening is a filter, not an oracle: a determined model could phrase a verdict that the
patterns miss. That is why the label, the side-by-side deterministic evidence and the
"never stored or exported" rule exist independently of the filter. See
`docs/evaluations/assist-eval.md` for measured behaviour of several local models.

## Development and verification

- Unit tests: `packages/correlation/src/**` (clustering, timeline, actions, context
  allowlisting, prompt, guardrails including red-team cases, provider).
- Browser-level: `pnpm e2e:firefox:assist` / `pnpm e2e:chromium:assist` build a DEV
  `--assist` bundle; the fixture server mocks an Ollama runtime on 127.0.0.1 (port 8787 for Firefox, 8788 for Chromium) whose
  canned answer contains a compromise claim and an unknown hostname, and the dashboard's
  DEV-only self-test page logs the probe result and the guardrail flags.
- Model evaluation: `pnpm eval:assist -- --endpoint http://127.0.0.1:11434 --models <a,b>`
  runs four synthetic scenarios through the real pipeline and writes
  `docs/evaluations/assist-eval.md`; `--rescreen <json>` re-applies the guardrails to saved
  answers without calling a model.
