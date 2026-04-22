import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Match the build-time globals declared by the workspace package
// (see packages/workspace/src/lib/agent-browser.ts and friends). Without
// these defines, importing anything that transitively touches those modules
// (e.g. `@instrument-org/workspace/electron`) blows up at module init in
// the test runner.
//
// `agent-browser`, `ffmpeg-static`, and `@derhuerst/ffprobe-static` live in
// `@instrument-org/workspace`'s deps (not studio's), so resolve them relative
// to that package's `package.json` instead of `apps/studio`.
const workspacePkgRequire = createRequire(
  require.resolve("@instrument-org/workspace/package.json"),
);

const GLOBAL_DEFINES = {
  __AGENT_BROWSER_BIN_DIR__: path.dirname(
    workspacePkgRequire.resolve("agent-browser/bin/agent-browser.js"),
  ),
  __FFMPEG_STATIC_PATH__: workspacePkgRequire.resolve("ffmpeg-static"),
  __FFPROBE_STATIC_PATH__: workspacePkgRequire.resolve(
    "@derhuerst/ffprobe-static",
  ),
} as const;

export default defineConfig({
  define: Object.fromEntries(
    Object.entries(GLOBAL_DEFINES).map(([key, value]) => [
      key,
      JSON.stringify(value),
    ]),
  ),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    clearMocks: true,
    exclude: ["node_modules", "dist", "directory", "out", "smoke-test.spec.ts"],
    setupFiles: ["src/tests/setup.ts"],
  },
});
