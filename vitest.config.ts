import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./vitest.alias";

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
