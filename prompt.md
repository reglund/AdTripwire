# CLAUDE CODE MASTER PROMPT
# Project: AdTripwire
## Open-Source Detection of Advertising-Based Surveillance and Spyware Delivery

You are acting as a senior security engineer, browser-extension architect, threat researcher, and full-stack developer.

Your assignment is to design and IMPLEMENT a working open-source security product called **AdTripwire**.

This is a real software development project, not a conceptual exercise. Produce maintainable, testable, secure code that can evolve into a publicly released product.

Work autonomously within the agreed development phase. Make reasonable technical decisions, document them, and verify that your implementation works.

Do not build a fake dashboard, simulated production detections, or nonfunctional placeholders that look finished.

## 1. PROJECT VISION

**Product name:** AdTripwire

**Tagline:** Detect the threat behind the ad.

**Mission:**

Develop a privacy-preserving browser security sensor that detects observable indicators of surveillance, invasive profiling, and potential spyware delivery through online advertising infrastructure.

The initial research focus is the AdFection attack technique documented by Citizen Lab and Confiant in October 2026.

However, AdTripwire must not be limited to one campaign, vendor, or set of indicators.

We want to build a reusable detection platform capable of identifying both known malicious infrastructure and suspicious behavioural patterns in advertising-related browser activity.

Our ultimate ambition is to help users, security researchers, journalists, NGOs, and security teams identify evidence of potentially malicious ad-based surveillance before or during attempts to deliver exploits.

This is not an advertisement blocker.

AdTripwire is primarily an **observation, detection, investigation, and evidence-generation tool**.

Blocking can be introduced as an optional feature later.

### Fundamental limitation

AdTripwire must NEVER claim that a device is free from spyware simply because nothing suspicious was detected.

It must distinguish between:

- Exposure to known suspicious infrastructure.
- Indicators of invasive advertising-based tracking.
- Suspicious delivery or execution patterns.
- Evidence consistent with an attempted exploit.
- Confirmed compromise, which generally requires independent forensic evidence.

Absence of detection is not evidence of absence.

## 2. RESEARCH BACKGROUND

Before implementing detection logic, review these sources:

### Primary research

Citizen Lab, October 15, 2026:

https://citizenlab.ca/research/how-discover-tech-turned-targeted-ads-into-a-pipeline-for-spyware/

Confiant Threat Intelligence, October 15, 2026:

https://blog.confiant.com/p/adint-weaponized-ad-tech-for-zero-click-spyware-and-mass-identity-vacuuming

### Existing open-source project

Zero Breach:

https://github.com/interplains/zero-breach

### Browser API documentation

Firefox response filtering:

https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData

Chrome webRequest:

https://developer.chrome.com/docs/extensions/reference/api/webRequest

Chrome content scripts:

https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

Read the documentation and establish which capabilities are genuinely available.

Do not assume that capabilities available in Firefox are also available in Chrome.

Do not invent undocumented APIs or depend on discontinued extension functionality.

Inspect the upstream projects' licenses before incorporating code or indicator datasets.

### Relevant attack characteristics

The documented AdFection activity includes:

1. Target selection through advertising infrastructure and RTB mechanisms.
2. Collection of device identifiers, browser characteristics, cookies, and other profiling information.
3. Communication with advertisement delivery systems that can selectively return JavaScript.
4. Server-side decisions about which devices receive additional code.
5. Suspicious iframe and JavaScript activity leading toward infrastructure associated with spyware delivery.
6. Potential browser exploitation and subsequent command-and-control communication.

Some activities are directly observable by an extension; others are not.

Build detection only around signals that the selected browser APIs can actually observe.

## 3. INITIAL PRODUCT SCOPE

The first working product is a Firefox browser extension.

Reasons:

- Firefox provides response-stream inspection capabilities unavailable through ordinary Chrome Manifest V3 webRequest APIs.
- JavaScript response analysis is important for this research.
- Firefox provides a useful initial research environment.

However, design the system for future Chrome and Chromium support using a shared detection engine and browser-specific sensor adapters.

### Initial target platforms

- Firefox on Linux, Windows, and macOS.
- Later: Chrome and Chromium.
- Later: optional standalone local network sensor.
- Later: enterprise and SIEM integration.

Use a standards-based WebExtensions approach wherever practical.

Use Manifest V3 if the required Firefox APIs work reliably with it. Verify the actual permission and background execution requirements.

If a documented incompatibility blocks a required capability, explain the issue and choose a supportable implementation rather than silently degrading functionality.

## 4. REQUIRED ARCHITECTURE

Use a modular architecture separating collection, detection, storage, presentation, and browser-specific implementation.

Suggested structure:

    adtripwire/
      README.md
      LICENSE
      CONTRIBUTING.md
      SECURITY.md
      package.json

      apps/
        extension-firefox/
        extension-chromium/

      packages/
        detection-engine/
        indicators/
        sensor-types/
        privacy/
        shared/

      tests/
        unit/
        integration/
        fixtures/
        performance/

      docs/
        architecture.md
        threat-model.md
        detection-methodology.md
        browser-capabilities.md
        privacy.md
        limitations.md
        testing.md

      .github/
        workflows/

Adapt this structure if there is a demonstrably better solution.

Recommended technology:

- TypeScript with strict type checking.
- Browser WebExtensions APIs.
- Vitest or a comparable testing framework.
- Lightweight local persistence using IndexedDB or extension storage.
- Small, maintainable UI.
- Minimal runtime dependencies.
- Local-first operation.

Avoid unnecessary frameworks, microservices, databases, or backend servers.

For the first version, the extension should work without a separate Python process, Docker container, cloud service, or external API.

Do not introduce an LLM dependency into the MVP.

The architecture must support later integration with a local correlation engine or local AI model without requiring a rewrite.

## 5. DETECTION ENGINE

Implement a rule-based detection engine with clear evidence and explainable outcomes.

The engine must accept normalized events from browser-specific sensors rather than depending directly on browser APIs.

Every detection rule must have:

- Stable rule identifier.
- Human-readable name.
- Description.
- Detection category.
- Severity.
- Confidence assessment.
- Required observable evidence.
- Source or research reference.
- Known limitations.
- False-positive considerations.
- Version.
- Automated tests.

Do not treat an isolated weak indicator as evidence of spyware.

### Detection category A: Known infrastructure

Detect communication with known, documented indicators from AdFection, Candiru, and related publicly reported campaigns.

Support:

- Exact hostname matching.
- Correct parent-domain and subdomain matching.
- URL-path pattern matching where justified.
- Known indicators with source attribution.
- Separate classifications for malicious infrastructure, surveillance-associated infrastructure, and contextual leads.

Relevant research includes the mtrtb.com and adtimizer.co infrastructure and specific documented delivery endpoints.

Do not blindly classify all advertising domains, CDNs, or CloudFront endpoints as malicious.

Use exact documented indicators and explicit matching rules.

Each indicator record should contain:

    indicator
    indicator_type
    source
    source_url
    campaign
    classification
    confidence
    first_reported
    last_reviewed
    enabled
    notes

Implement careful hostname normalization and boundary-safe domain matching.

### Detection category B: Suspicious ad-delivery behaviour

Identify suspicious combinations of:

- Advertising-related requests to known suspicious infrastructure.
- Selective JavaScript retrieval patterns.
- Redirect chains from advertising contexts.
- Dynamically loaded scripts.
- Suspicious nested iframe relationships.
- Unexpected cross-origin script-delivery sequences.

Where response inspection is supported, inspect relevant JavaScript responses without changing the original response bytes.

The known NOAS/getAd pattern is an important initial use case.

However, a request returning zero bytes is not inherently suspicious.

Likewise, a response containing JavaScript is not inherently malicious.

Correlate multiple signals before raising a significant warning.

### Detection category C: Fingerprinting and invasive profiling

Detect observable combinations of high-risk profiling behaviour, such as:

- Device and environment fingerprinting.
- Browser feature enumeration.
- Canvas or WebGL-based fingerprinting indicators.
- Collection of high-entropy browser attributes.
- Potential transmission of first-party cookie material.
- Correlation between suspicious ad contexts and profiling-related requests.

Distinguish standard advertising behaviour from activity with stronger surveillance indicators.

A single fingerprinting API invocation must not trigger a high-severity alert.

Avoid collecting actual cookie values, authentication material, or personal identifiers.

If a URL or query parameter suggests that sensitive material is being transmitted, record a sanitized description of the observation, not the sensitive value.

Do not claim to detect arbitrary JavaScript execution if the browser sensor only sees request metadata.

### Detection category D: Suspicious JavaScript techniques

Where supported by the selected browser APIs, inspect relevant responses for combinations of:

- Dynamic function construction.
- Runtime code evaluation.
- Obfuscation indicators.
- Suspicious WebSocket usage.
- Suspicious cross-origin execution patterns.
- Embedded scripts that fetch further executable content.
- Techniques documented by Citizen Lab or Confiant.

Ordinary use of eval, new Function, WebSocket, or cryptographic APIs is not sufficient evidence of malicious activity.

Use context, provenance, and correlated signals.

Implement conservative, explainable rules.

Do not build invasive global JavaScript hooks into every webpage unless justified and explicitly enabled.

If page-context instrumentation is introduced, isolate it behind an optional sensor with a documented threat model.

### Detection category E: Temporal correlation

A major differentiator for AdTripwire should be its ability to correlate events over time.

For example:

    Known suspicious ad endpoint observed
               |
               v
    Subsequent suspicious JS response
               |
               v
    Unexpected iframe destination
               |
               v
    Contact with independently documented
    exploit-delivery infrastructure
               |
               v
    High-priority investigation event

Implement configurable temporal correlation windows.

Do not assume that temporal proximity proves causation.

Record which observations support the sequence and which relationships are inferred.

Maintain separate confidence and severity fields.

### Detection category F: Repeated exposure

Detect repeated contact with specific suspicious infrastructure over time.

Keep this distinct from actual targeted spyware delivery.

Repeated contact may indicate exposure, ordinary advertising behaviour, or surveillance-related profiling.

Never automatically classify repeated exposure as a confirmed targeted attack.

## 6. EVENT AND EVIDENCE MODEL

Define a strongly typed event schema.

Events should contain fields such as:

    event_id
    timestamp
    browser
    sensor
    event_type
    initiator_origin
    destination_hostname
    normalized_path_pattern
    resource_type
    frame_context
    request_status
    response_size_if_observable
    matched_indicators
    matched_rules
    correlation_id
    evidence_quality
    observation_limitations

Only store information actually available from the sensor.

Do not populate unsupported fields with invented or inferred values.

Use a separate detection record that references contributing event IDs.

Detections must support:

- Observed facts.
- Inferences.
- Missing visibility.
- Alternative explanations.
- Rule version.
- Supporting source material.
- Recommended investigative actions.

Implement stable JSON schemas suitable for later SIEM integration.

## 7. PRIVACY AND SECURITY REQUIREMENTS

AdTripwire is a security tool that processes potentially sensitive browsing information.

Its own security and privacy posture must be exceptionally strong.

### Mandatory privacy principles

- Local processing by default.
- No telemetry.
- No analytics SDK.
- No cloud account.
- No advertising identifiers.
- No automatic remote upload.
- No recording full browsing histories.
- No storage of raw cookies or authentication tokens.
- No collection of webpage content unrelated to detection.
- No raw HTTP request or response dumps by default.
- No storage of complete URLs containing query secrets.
- Explicit consent for broader monitoring permissions.

Use sanitized hostnames, URL patterns, query parameter names, and bounded metadata.

Avoid persisting full query values or arbitrary path segments that could contain private data.

Provide configurable local retention with a conservative default, for example seven days.

Users must be able to delete all collected data.

All export functions must sanitize potentially identifying information by default.

### Extension security

Assume webpages are potentially hostile.

Implement:

- Strict validation of messages from content scripts.
- Separation between privileged background contexts and untrusted page contexts.
- No unsafe evaluation of remote content.
- No remote hosted extension code.
- Strict Content Security Policy.
- Minimal privileged API exposure.
- No unrestricted webpage-triggered privileged requests.
- Safe rendering of untrusted detection data.
- Explicit extension permission handling.
- Dependency auditing.
- No embedded API keys or secrets.

Review prototype pollution, XSS, message spoofing, unsafe URL handling, and resource exhaustion risks.

### Firefox response filtering

If using `webRequest.filterResponseData()`:

- Preserve the response content byte-for-byte.
- Never execute the inspected content.
- Implement reliable pass-through behaviour.
- Correctly handle stream completion and errors.
- Never leave a response stream stalled.
- Limit buffering and analysis size.
- Avoid expensive synchronous operations in the response path.
- Handle unsupported or unexpected encodings safely.
- Measure response-processing overhead.

The browser's normal operation must take priority over analysis.

### Passive-first policy

The initial version must be detection-only.

No automatic blocking, cancellation, request modification, or exploitation.

Do not implement automatic visits to suspicious infrastructure.

Testing must use synthetic fixtures and explicitly controlled local environments, not live malicious endpoints.

## 8. USER INTERFACE

Create a minimal but professional interface.

The visual design should communicate credibility and technical precision.

Avoid exaggerated cybersecurity styling.

### Toolbar popup

Display:

**AdTripwire**

Current monitoring state:

    Monitoring active

Summary:

    Known IOC observations: 0
    Suspicious patterns: 0
    High-priority detections: 0

Last significant observation.

Link to investigation dashboard.

Provide a clear explanation that no detections does not establish device safety.

### Investigation dashboard

Include:

**Overview**

High-level monitoring status, recent detections, and sensor visibility.

**Detections**

Chronological list of detections with filtering by category, severity, and confidence.

**Detection details**

For every detection show:

- What was observed.
- Why it matters.
- Which rule triggered.
- Which evidence supports it.
- Relevant event sequence.
- Source references.
- Potential benign explanations.
- Suggested investigation steps.
- Detection limitations.

**Indicators**

Display loaded indicator sets, sources, versions, and update status.

**Settings**

Monitoring controls, permissions, retention, export, and deletion.

### Alert presentation

Use conservative language.

Good:

"Traffic to infrastructure documented in the AdFection investigation was observed."

Good:

"Multiple suspicious activities were correlated in an advertising context."

Bad:

"You are being spied on."

Bad:

"Your device has been infected."

Bad:

"Your browser is safe."

Never display a compromise claim without independent evidence that can support it.

### Evidence export

Provide a sanitized JSON export containing:

- Product version.
- Browser and sensor capabilities.
- Ruleset version.
- Relevant observations.
- Detections.
- Evidence.
- Confidence and severity.
- Visibility limitations.
- Timestamp.
- Redaction metadata.

Make exports suitable for incident response analysis.

## 9. INDICATOR MANAGEMENT

Implement a normalized indicator format independent of upstream providers.

Research the indicators published by:

- Citizen Lab.
- Confiant.
- Zero Breach.
- Other reputable security research organizations when relevant.

Preserve provenance and licensing information.

Do not blindly import every indicator from an upstream repository.

Validate indicator syntax and classification.

Reject malformed or overly broad patterns.

Ensure test domains and synthetic fixtures are clearly separated from real threat indicators.

The initial version may bundle a reviewed indicator set.

Design for later optional updates.

Future indicator updates should include integrity verification, versioning, validation, and controlled rollback.

Do not silently depend on an external service for core functionality.

## 10. DETECTION CONFIDENCE MODEL

Implement a transparent decision model rather than arbitrary numerical risk scores.

Suggested detection classifications:

**Informational**
An observable event relevant to monitoring, but insufficient to suggest malicious activity.

**Suspicious**
A weak or moderate signal requiring context.

**Elevated**
Multiple corroborating signals or a documented suspicious infrastructure match.

**High priority**
A strong combination of indicators consistent with a documented attack-delivery sequence.

These are investigation priorities, not probabilities of compromise.

Maintain confidence separately:

    low
    medium
    high

Each rule must explicitly state what establishes its confidence.

A high-confidence infrastructure match can still be low-confidence evidence of personal targeting.

Do not equate infrastructure attribution with confirmed spyware execution.

For correlated detections, retain the contributing evidence rather than returning only a final score.

## 11. TESTING REQUIREMENTS

Create a rigorous automated test suite.

### Unit tests

Test:

- Domain normalization.
- Domain boundary matching.
- Indicator parsing.
- URL sanitization.
- Detection rule evaluation.
- Event correlation.
- Confidence classification.
- Deduplication.
- Storage retention.
- Export redaction.

### Synthetic attack-chain tests

Build controlled fixtures emulating:

1. Ordinary advertisement loading.
2. Benign fingerprinting activity.
3. Contact with a known test indicator.
4. Selective JavaScript response behaviour.
5. Suspicious iframe creation.
6. Correlated multi-stage suspicious activity.
7. False-positive scenarios.
8. Large or malformed responses.
9. Events with incomplete metadata.
10. Extension restart during monitoring.

All test infrastructure must be local or explicitly controlled.

Use reserved test domains rather than connecting to production threat infrastructure.

### Performance tests

Measure:

- Browser overhead attributable to monitoring.
- Memory usage.
- Detection-processing latency.
- Response-stream overhead.
- Performance with large numbers of requests.
- Persistence and recovery across browser restarts.

Avoid unbounded event queues or memory growth.

### Detection quality

Maintain two separate evaluations:

1. **Synthetic coverage:** How many known test scenarios are correctly detected?
2. **Real-world false positives:** How frequently do rules produce misleading alerts during benign browsing?

Do not publish synthetic test performance as real-world threat detection accuracy.

Create a reproducible benign-traffic evaluation method.

Document scenarios that cannot be tested without access to genuine attack samples.

## 12. DEVELOPMENT ROADMAP

Work through the project in controlled phases.

### Phase 1 — Working Firefox MVP

Deliver a functional Firefox extension that:

- Installs successfully.
- Starts monitoring after the necessary permissions are granted.
- Observes supported network requests.
- Matches a curated set of documented IOC indicators.
- Inspects narrowly selected response content where supported.
- Applies basic explainable detection rules.
- Correlates a simple sequence of suspicious events.
- Stores sanitized detections locally.
- Displays a functioning popup.
- Displays a functioning investigation view.
- Exports sanitized evidence.
- Includes automated tests.
- Includes instructions for running and testing.

The final result must be usable, not merely scaffolded.

### Phase 2 — Enhanced behavioural detection

Expand:

- Context-aware JavaScript analysis.
- Ad-frame correlation.
- More sophisticated event sequences.
- Stronger separation of benign and suspicious activity.
- Performance optimizations.
- Extended indicator provenance.
- Real-world false-positive testing.

### Phase 3 — Chrome/Chromium support

Create a Chrome-compatible sensor using supported Manifest V3 APIs.

Reuse the detection engine and UI as appropriate.

Document capabilities unavailable on Chrome.

Do not fake response-body inspection.

Use browser capability declarations to determine which rules can execute.

### Phase 4 — Security research integration

Evaluate:

- Importing Zero Breach results.
- Optional Zeek/Suricata integration.
- IOC feeds.
- STIX 2.1 export.
- SIEM-compatible JSON.
- Investigation workflows.

Only implement integrations that add measurable value.

### Phase 5 — Advanced local correlation

Evaluate optional local AI assistance for:

- Explaining detections.
- Clustering related events.
- Summarizing suspicious timelines.
- Suggesting investigative actions.

A model's interpretation must never replace underlying evidence or deterministic detection logic.

Do not allow a local AI model to autonomously declare a device compromised.

## 13. QUALITY AND ENGINEERING STANDARDS

This must be engineered as a maintainable open-source product.

Requirements:

- Strict TypeScript.
- Clear module boundaries.
- No unnecessary dependencies.
- Reproducible builds.
- Consistent formatting and linting.
- Automated tests.
- GitHub Actions CI.
- Dependency security checks.
- Helpful error handling.
- Structured, privacy-safe local diagnostics.
- Accessible UI.
- Clear onboarding.
- Documented permissions.
- Documented limitations.
- No placeholder production features.

Prefer a permissive open-source license such as Apache-2.0, provided dependencies and imported resources are compatible.

Do not copy upstream copyrighted code or indicator content without checking the applicable license and attribution requirements.

Write documentation and code comments in English.

Ensure the project can be built on Ubuntu Linux with clearly documented prerequisites.

## 14. RESEARCH AND IMPLEMENTATION DISCIPLINE

Before making architectural decisions:

- Inspect the current repository.
- Determine whether existing source code should be preserved.
- Verify available build tools.
- Review current browser API documentation.
- Check whether the intended extension architecture is supported.
- Identify implementation risks.

If an assumption is incorrect, modify the design and document why.

Do not hide technical limitations.

Do not claim tests pass unless they have actually executed successfully.

Do not claim browser functionality has been verified unless it has actually been tested in the relevant browser.

If Firefox cannot be launched or an integration test cannot be run in the current environment, state this explicitly and provide a manual verification procedure.

Avoid unnecessary abstractions and excessive up-front infrastructure.

Prioritize a small, reliable implementation over a large, speculative system.

Do not use fake threat intelligence, invented indicators, or fictional attribution in production datasets.

Maintain clear separation between real indicators and synthetic test data.

## 15. ACCEPTANCE CRITERIA FOR PHASE 1

Phase 1 is complete only when:

- The Firefox extension builds without errors.
- A real extension package can be installed or loaded.
- The monitoring sensor is operational.
- The indicator matcher correctly handles documented indicators and domain boundaries.
- Relevant supported network metadata is captured.
- Response inspection works where available without changing response bytes.
- Detection rules produce explainable results.
- A synthetic suspicious event produces a visible detection.
- A benign test scenario does not incorrectly produce a high-priority finding.
- Detection history survives normal extension restart.
- Local data deletion works.
- JSON evidence export works and is redacted.
- Unit tests pass.
- Relevant integration tests pass or are explicitly marked unverified.
- The README explains installation, usage, and limitations.
- Security and privacy assumptions are documented.

## 16. REQUIRED DELIVERABLES

At the conclusion of Phase 1, provide:

1. Working source code in the current repository.
2. Reproducible build and development commands.
3. Installation instructions for Firefox.
4. Automated tests and actual test results.
5. An explanation of the implemented detection rules.
6. A concise architecture description.
7. A capability and visibility matrix.
8. A list of known technical limitations.
9. A summary of security and privacy considerations.
10. A proposed priority order for Phase 2.

In the final summary, distinguish between:

- Implemented and verified.
- Implemented but not verified.
- Planned but not implemented.

## 17. WORKING STYLE AND EXECUTION INSTRUCTIONS

IMPORTANT:

You are expected to write code and deliver a working implementation, not simply produce design documents.

Do not continuously ask me to make routine technical decisions.

Choose sensible defaults and document them.

Do not stop after generating a project skeleton.

Do not introduce unnecessary complexity.

Keep me informed through concise explanations of meaningful decisions and any technical blockers.

Do not execute destructive filesystem or Git operations without explicit approval.

Use version control appropriately and avoid overwriting existing work.

**Work one development phase at a time.**

You are authorized to complete Phase 1.

Do not proceed to Phase 2 until I explicitly approve it.

Within Phase 1, independently perform the necessary analysis, implementation, testing, and debugging.

If an important technical limitation forces a major deviation from the product requirements, explain it before implementing the alternative.

## 18. START NOW

Start by examining the current working directory and development environment.

Read the authoritative research and browser API documentation.

Establish the actual Firefox capabilities required for the MVP.

Create a concise Phase 1 implementation plan and then execute it.

Implement the complete working Firefox MVP.

Run the available tests and fix identified defects.

Provide a clear final report covering what works, what was tested, what remains unverified, and how to install the extension.

Stop after Phase 1 and await my instruction before starting Phase 2.

**The primary success criterion is simple: I should be able to install AdTripwire in Firefox, browse normally, and have it detect, explain, and preserve evidence of suspicious advertising-related activity when supported indicators or behaviours are observed.**
