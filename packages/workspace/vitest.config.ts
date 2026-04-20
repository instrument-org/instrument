import { defineConfig } from "vitest/config";

import { GLOBAL_DEFINES } from "./scripts/lib/define-globals";

export default defineConfig({
  define: Object.fromEntries(
    Object.entries(GLOBAL_DEFINES).map(([key, value]) => [
      key,
      JSON.stringify(value),
    ]),
  ),
  test: {
    clearMocks: true,
    exclude: ["node_modules", "*.local"],
    typecheck: {
      enabled: true,
      ignoreSourceErrors: true,
    },
  },
});
