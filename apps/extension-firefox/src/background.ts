/**
 * Firefox entry: wires the shared background to the Firefox sensor (webRequest + StreamFilter).
 */
import { startBackground } from "@adtripwire/extension-core";
import { WebRequestSensor, detectCapabilities } from "@adtripwire/sensor-firefox";

startBackground({
  browserName: "firefox",
  detectCapabilities,
  createSensor: (opts) => new WebRequestSensor(opts),
});
