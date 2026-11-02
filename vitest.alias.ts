import { fileURLToPath } from "node:url";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

/** Lets tests outside workspace packages (tests/**) import @adtripwire/* from source. */
export const workspaceAliases = {
  "@adtripwire/shared": pkg("shared"),
  "@adtripwire/indicators": pkg("indicators"),
  "@adtripwire/privacy": pkg("privacy"),
  "@adtripwire/interop": pkg("interop"),
  "@adtripwire/detection-engine": pkg("detection-engine"),
  "@adtripwire/correlation": pkg("correlation"),
  "@adtripwire/sensor-firefox": pkg("sensor-firefox"),
  "@adtripwire/sensor-chromium": pkg("sensor-chromium"),
  "@adtripwire/extension-core": pkg("extension-core"),
};
