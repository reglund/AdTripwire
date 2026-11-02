import type { Rule } from "./types.js";
import { rule as maliciousContact } from "./known-infra-malicious.js";
import { rule as surveillanceContact } from "./known-infra-surveillance.js";
import { rule as contextualContact } from "./known-infra-contextual.js";
import { rule as noasRequest } from "./ad-delivery-noas-request.js";
import { rule as noasSelectiveResponse } from "./ad-delivery-noas-selective-response.js";
import { rule as redirectChain } from "./ad-delivery-redirect-chain.js";
import { rule as nestedFrame } from "./ad-delivery-nested-frame.js";
import { rule as identifierRich } from "./profiling-identifier-rich.js";
import { rule as fingerprintingAdContext } from "./profiling-fingerprinting-ad-context.js";
import { rule as dynamicCodeTransport } from "./js-dynamic-code-transport.js";
import { rule as hiddenIframe } from "./js-hidden-iframe.js";
import { rule as cookieExfil } from "./js-cookie-exfil.js";
import { rule as adfectionSdk } from "./js-adfection-sdk.js";
import { rule as dohRawIp } from "./js-doh-raw-ip.js";
import { rule as antiAnalysis } from "./js-anti-analysis.js";
import { rule as adfectionChain } from "./correlation-adfection-chain.js";
import { rule as jsThenMalicious } from "./correlation-js-then-malicious.js";
import { rule as noasHiddenFrame } from "./correlation-noas-hidden-frame.js";
import { rule as repeatedExposure } from "./exposure-repeated.js";
import { rule as pageSdkReady } from "./page-sdk-ready-message.js";
import { rule as pageHiddenIframe } from "./page-hidden-iframe-after-load.js";
import { rule as pageLateScript } from "./page-late-third-party-script.js";

export const ALL_RULES: readonly Rule[] = Object.freeze([
  maliciousContact,
  surveillanceContact,
  contextualContact,
  noasRequest,
  noasSelectiveResponse,
  redirectChain,
  nestedFrame,
  identifierRich,
  fingerprintingAdContext,
  dynamicCodeTransport,
  hiddenIframe,
  cookieExfil,
  adfectionSdk,
  dohRawIp,
  antiAnalysis,
  adfectionChain,
  jsThenMalicious,
  noasHiddenFrame,
  repeatedExposure,
  pageSdkReady,
  pageHiddenIframe,
  pageLateScript,
]);

export type { Rule, RuleContext, EventWindow, ExposureStore } from "./types.js";
export { jsGrade } from "./js-common.js";
export { isNoasPattern } from "./noas.js";
export { isNoasPath } from "./common.js";
