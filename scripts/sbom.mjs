/**
 * CycloneDX 1.5 SBOM for a release. The shipped extension has zero runtime dependencies; the
 * SBOM therefore lists the product, the bundled data (indicator set, Public Suffix List) and
 * the build-time toolchain resolved from pnpm-lock.yaml so a build can be audited.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function lockVersions(root) {
  // Minimal YAML walk: importers['.'].devDependencies.<name>.version
  const text = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const out = new Map();
  const m = text.match(/\nimporters:\n {2}\.:\n([\s\S]*?)\n {2}[^ ]/);
  const block = m ? m[1] : "";
  const dev = block.split(/\n {4}devDependencies:\n/)[1] ?? "";
  let current = null;
  for (const line of dev.split("\n")) {
    const dep = /^ {6}('?)([^\s:']+)\1:\s*$/.exec(line);
    if (dep) {
      current = dep[2];
      continue;
    }
    const ver = /^ {8}version:\s*([^\s(]+)/.exec(line);
    if (ver && current) out.set(current, ver[1]);
    if (/^ {4}\S/.test(line)) break;
  }
  return out;
}

export function buildSbom(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const indicators = JSON.parse(
    readFileSync(join(root, "packages/indicators/data/adfection-2026.json"), "utf8"),
  );
  const psl = JSON.parse(
    readFileSync(join(root, "packages/indicators/data/public-suffix-list.json"), "utf8"),
  );
  const versions = lockVersions(root);
  const tools = Object.keys(pkg.devDependencies ?? {})
    .sort()
    .map((name) => ({
      type: "library",
      "bom-ref": `tool:${name}`,
      name,
      version: versions.get(name) ?? pkg.devDependencies[name],
      purl: `pkg:npm/${name.replace("@", "%40")}@${versions.get(name) ?? ""}`,
      scope: "excluded",
      description: "build-time only; not shipped",
    }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": "adtripwire",
        name: "adtripwire",
        version: pkg.version,
        description: pkg.description,
        licenses: [{ license: { id: "Apache-2.0" } }],
      },
      properties: [
        { name: "adtripwire:runtime-dependencies", value: "0" },
        { name: "adtripwire:node-engine", value: pkg.engines?.node ?? "" },
        { name: "adtripwire:package-manager", value: pkg.packageManager ?? "" },
      ],
    },
    components: [
      {
        type: "data",
        "bom-ref": "data:indicators",
        name: indicators.meta.id,
        version: indicators.meta.version,
        description: indicators.meta.name,
        licenses: [{ license: { id: "CC0-1.0" } }],
        properties: [
          { name: "adtripwire:indicator-count", value: String(indicators.indicators.length) },
        ],
      },
      {
        type: "data",
        "bom-ref": "data:public-suffix-list",
        name: "public-suffix-list",
        version: String(psl.fetchedAt ?? "bundled"),
        description: "Mozilla Public Suffix List, ICANN section",
        licenses: [{ license: { id: "MPL-2.0" } }],
      },
      ...tools,
    ],
  };
}
