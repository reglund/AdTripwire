import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./vitest.alias";

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: ["tests/performance/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
  },
});
