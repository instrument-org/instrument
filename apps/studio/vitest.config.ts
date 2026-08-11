import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Spelled with its extension because Vite's native config loader -- the one
// that will read this file once it becomes the default -- resolves the
// specifier as written rather than guessing. `allowImportingTsExtensions` in
// `tsconfig.json` is there for this import and nothing else.
import { ariaSnapshot } from "./src/tests/commands/aria-snapshot.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Match the build-time globals declared by the workspace package
// (see packages/workspace/src/lib/agent-browser.ts and friends). Without
// these defines, importing anything that transitively touches those modules
// (e.g. `@instrument-org/workspace/electron`) blows up at module init in
// the test runner.
//
// `agent-browser` and `ffmpeg-ffprobe-static` live in
// `@instrument-org/workspace`'s deps (not studio's), so resolve them relative
// to that package's `package.json` instead of `apps/studio`.
const workspacePkgRequire = createRequire(
  require.resolve("@instrument-org/workspace/package.json"),
);

const GLOBAL_DEFINES = {
  __AGENT_BROWSER_BIN_DIR__: path.dirname(
    workspacePkgRequire.resolve("agent-browser/bin/agent-browser.js"),
  ),
  __FFMPEG_FFPROBE_STATIC_PATH__: workspacePkgRequire.resolve(
    "ffmpeg-ffprobe-static",
  ),
} as const;

const reactCompilerBabel = await babel({
  presets: [reactCompilerPreset()],
});

const SHARED_EXCLUDE = [
  "node_modules",
  "dist",
  "directory",
  "out",
  "smoke-test.spec.ts",
];

export default defineConfig({
  define: Object.fromEntries(
    Object.entries(GLOBAL_DEFINES).map(([key, value]) => [
      key,
      JSON.stringify(value),
    ]),
  ),
  // A measured test that renders without the app's stylesheet is measuring a
  // different app, so the browser project loads `globals.css` for real and
  // needs the plugin that compiles it. Inert for the other two projects, which
  // process no CSS.
  //
  // The React Compiler is the other half of that: a component it has rewritten
  // is not the component in the source, and the differences are exactly the
  // ones a render test is for -- what re-renders, and what a cached value goes
  // on reporting after its inputs stop changing. So the suite runs the compiled
  // component, the same as the app does.
  plugins: [tailwindcss(), reactCompilerBabel],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    // A Radix package reached only from the component under test gets
    // pre-bundled on its own and pulls a second React with it, which fails on
    // the first hook it runs. Pinning one copy keeps such a component
    // renderable in the browser project.
    dedupe: ["react", "react-dom"],
  },
  test: {
    clearMocks: true,
    // Three environments, chosen by extension so a file declares which it wants
    // by what it is. Reach for the cheapest one that can actually observe the
    // behavior:
    //
    // - `.test.ts`         node, no DOM. Plain logic. Most tests belong here.
    // - `.test.tsx`        jsdom. Rendering, props, refs. No layout, and no
    //                      `selectionchange`, so nothing the browser itself
    //                      drives can be seen.
    // - `.browser.test.tsx`  real Chromium. Typing, selection, caret, measured
    //                      layout. Slow and heavier to run, so it earns its
    //                      place only where jsdom is blind.
    projects: [
      {
        extends: true,
        test: {
          exclude: [...SHARED_EXCLUDE, "**/*.test.tsx"],
          name: "node",
          setupFiles: ["src/tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          environment: "jsdom",
          exclude: [...SHARED_EXCLUDE, "**/*.browser.test.tsx"],
          include: ["**/*.test.tsx"],
          name: "dom",
          setupFiles: ["src/tests/setup.ts", "src/tests/setup-dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          browser: {
            // Playwright can serialize an accessibility tree and Vitest's own
            // browser API cannot, so the one thing this project would otherwise
            // have to drive the app to see is reached through a command.
            commands: { ariaSnapshot },
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }],
            provider: playwright(),
            // A trace carries a DOM snapshot per action, plus console and
            // network, and is written next to the test only when one fails. It
            // is what makes a failure here readable without reproducing it,
            // which matters most for the failures that are expensive to
            // reproduce. Open one at https://trace.playwright.dev.
            trace: "retain-on-failure",
            // Vitest's default is a phone, which is not a size any part of this
            // app is designed against: anything not given a width by its test
            // would lay itself out for one. Pinned rather than left to follow
            // the default so a measured result does not move under a Vitest
            // upgrade.
            viewport: { height: 900, width: 1280 },
          },
          exclude: SHARED_EXCLUDE,
          include: ["**/*.browser.test.tsx"],
          name: "browser",
          // A real browser brings real timing. Locally a flake is worth seeing;
          // on CI it is worth a second look before failing the run.
          retry: process.env.CI ? 2 : 0,
          setupFiles: ["src/tests/setup-browser.ts"],
        },
      },
    ],
  },
});
