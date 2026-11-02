/**
 * DEV-only startup self-test: verifies the published signed indicator bundle with the
 * browser's own WebCrypto so the browser-level test proves Ed25519 verification works in
 * this browser build. Loaded through a dynamic import inside `if (__ADTRIPWIRE_DEV__)`, so
 * production bundles contain neither this code nor the bundle payload.
 */
import { verifySignedBundle } from "@adtripwire/indicators";
import feed from "../../../../feeds/adtripwire-indicators-2026.11.02.signed.json";

export async function runSignedBundleSelfTest(
  expectedSetId: string,
  log: (level: "info" | "warn", msg: string) => void,
): Promise<void> {
  const r = await verifySignedBundle(feed as unknown, { expectedSetId });
  log(
    "info",
    r.ok
      ? `signed bundle selftest ok key=${r.key.keyId} version=${r.bundle.meta.version}`
      : `signed bundle selftest failed: ${r.errors.join("; ")}`,
  );
}
