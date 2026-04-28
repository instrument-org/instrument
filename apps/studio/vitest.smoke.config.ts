import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    clearMocks: true,
    exclude: ["node_modules", "dist", "directory", "out"],
    hookTimeout: 300_000,
    include: ["smoke-test.spec.ts"],
    pool: "forks",
    testTimeout: 120_000,
  },
});
