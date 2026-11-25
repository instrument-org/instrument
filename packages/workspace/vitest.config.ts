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
    // Shells run on the test's own thread, where `vi.mock` reaches them, unless
    // INSTRUMENT_BASH_WORKER=1 asks for every one to run in the bash worker.
    // That setup file is listed only then: a setup file's imports are related
    // to every test file, and the worker client's reach most of the package,
    // so `vitest related` on almost any edit would run the whole suite.
    setupFiles: [
      "./src/test/setup.ts",
      ...(process.env.INSTRUMENT_BASH_WORKER === "1"
        ? ["./src/test/setup-bash-worker.ts"]
        : []),
    ],
    typecheck: {
      enabled: true,
      ignoreSourceErrors: true,
    },
  },
});
