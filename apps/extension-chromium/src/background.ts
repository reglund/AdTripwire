/**
 * Chromium entry: shared background + observational Chromium sensor (no body inspection).
 */
import "./shim.js";
import { startBackground } from "@adtripwire/extension-core";
import {
  ChromiumWebRequestSensor,
  asChromeLike,
  detectChromiumCapabilities,
} from "@adtripwire/sensor-chromium";

startBackground({
  browserName: "chromium",
  detectCapabilities: detectChromiumCapabilities,
  createSensor: (opts) => new ChromiumWebRequestSensor(opts, { api: asChromeLike(chrome) }),
});
