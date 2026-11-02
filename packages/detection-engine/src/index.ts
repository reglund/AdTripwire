export { DetectionEngine } from "./engine.js";
export type { DetectionEngineOptions, IngestResult, RuleStatus, EngineSnapshot } from "./engine.js";
export { ALL_RULES, jsGrade, isNoasPattern, isNoasPath } from "./rules/index.js";
export type { Rule, RuleContext, EventWindow, ExposureStore } from "./rules/types.js";
export {
  analyzeJavaScript,
  JS_MARKER_DESCRIPTIONS,
  DEFAULT_JS_ANALYSIS_MAX_CHARS,
} from "./js-analyzer.js";
export type { JsAnalysisResult, JsAnalysisStats } from "./js-analyzer.js";
export { MemoryExposureStore } from "./exposure.js";
export type { ExposureSnapshot, MemoryExposureStoreOptions } from "./exposure.js";
export { BoundedEventWindow, DEFAULT_MAX_WINDOW_EVENTS } from "./window.js";
export { NOAS_QUERY_MACROS } from "./params.js";
