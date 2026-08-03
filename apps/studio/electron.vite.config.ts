import type { Plugin } from "vite";

import { ValidateEnv } from "@julr/vite-plugin-validate-env";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPackage } from "read-pkg";
import { analyzer } from "vite-bundle-analyzer";

const isAnalyzing = process.env.ANALYZE_BUILD === "true";

const monorepoNamespace = "@instrument-org";
// Not including "components" it will be bundled by default in the client
const monorepoPackages = ["workspace", "shared", "ai-gateway"];

async function getMonorepoDeps(packageName: string) {
  const pkg = await readPackage({
    cwd: path.join(process.cwd(), `../../packages/${packageName}`),
  });
  return Object.keys(pkg.dependencies ?? {}).filter(
    (dep) => !dep.startsWith(monorepoNamespace),
  );
}

const monorepoDepsPromises = await Promise.all(
  monorepoPackages.map(getMonorepoDeps),
);
const monorepoDeps = [...new Set(monorepoDepsPromises.flat())];

const mainExternalizeExclude = [
  // Monorepos packages export .ts files, which must be bundled
  ...monorepoPackages.map((pkg) => `${monorepoNamespace}/${pkg}`),
  "execa", // Unsure why this is needed, maybe ESM vs CJS?
];

const resolve = {
  alias: {
    "@": path.join(path.dirname(fileURLToPath(import.meta.url)), "src"),
  },
};

let stagingCounter = 0;

// `buildStart` fires on every watch rebuild, so re-copying ~11MB of WASM each
// time is skipped when the destination already holds the current bytes. The
// mtime has to match exactly rather than merely be newer: pnpm hard links from
// its store, which carries the store's timestamps, so a reinstall can drop in a
// same-size asset that is older than what was copied before. Both sides are
// truncated to whole milliseconds because the stamp below goes through a `Date`,
// which drops the sub-millisecond precision a source file can carry.
async function copyVendorAsset({ from, to }: { from: string; to: string }) {
  const source = await fs.stat(from);
  try {
    const target = await fs.stat(to);
    if (
      target.size === source.size &&
      Math.trunc(target.mtimeMs) === Math.trunc(source.mtimeMs)
    ) {
      return;
    }
  } catch {
    // No destination yet.
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  // Stage then rename so an interrupted or concurrent build cannot leave a torn
  // binary in place, and stamp the source mtime so the skip check above holds.
  // The staging name is unique per writer: two builds sharing one checkout
  // would otherwise interleave into the same temp path, and the rename would
  // publish the mixed bytes with a current-looking mtime.
  const staging = `${to}.${process.pid}.${stagingCounter++}.tmp`;
  await fs.copyFile(from, staging);
  await fs.utimes(staging, source.atime, source.mtime);
  await fs.rename(staging, to);
}

// Registered on the main build alone. Every `electron-vite dev` and `build`
// invocation builds main, and the destinations are read by the main process, so
// a second registration would only add copies racing each other.
function copyVendorAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const resourcesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "resources",
  );
  const vendorDir = path.join(resourcesDir, "vendor");
  const assets = [
    {
      from: require.resolve("@tailwindcss/browser"),
      to: path.join(resourcesDir, "tailwind-browser.js"),
    },
    // The renderer runs from `file://` in production, where `fetch()` of
    // bundled assets is blocked, so these are served over the app protocol
    // from `resources/` instead of being emitted into the renderer bundle.
    {
      from: require.resolve("@embedpdf/pdfium/pdfium.wasm"),
      to: path.join(vendorDir, "pdfium.wasm"),
    },
    {
      from: require.resolve("@extend-ai/react-docx/docx_wasm_bg.wasm"),
      to: path.join(vendorDir, "docx.wasm"),
    },
    {
      from: require.resolve("@extend-ai/react-pptx/pptx_wasm_bg.wasm"),
      to: path.join(vendorDir, "pptx.wasm"),
    },
    {
      from: require.resolve("@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm"),
      to: path.join(vendorDir, "xlsx.wasm"),
    },
    {
      from: require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"),
      to: path.join(vendorDir, "sqlite3.wasm"),
    },
  ];
  return {
    async buildStart() {
      for (const { from, to } of assets) {
        await copyVendorAsset({ from, to });
      }
    },
    name: "copy-vendor-assets",
  };
}

/**
 * Creates a plugin to validate production environment variables based on context.
 *
 * Electron Vite environment variable naming scheme:
 * - KEY=123                # not available
 * - MAIN_VITE_KEY=123      # only available in main process
 * - PRELOAD_VITE_KEY=123   # only available in preload scripts
 * - RENDERER_VITE_KEY=123  # only available in renderers
 * - VITE_KEY=123           # available in all processes
 */
function createValidateProductionEnv(
  context: "main" | "preload" | "renderer",
): Plugin {
  // Map of required environment variables by context
  const requiredVarsByContext = {
    main: ["MAIN_VITE_GOOGLE_CLIENT_ID", "MAIN_VITE_GOOGLE_CLIENT_SECRET"],
    preload: [] as string[],
    renderer: [] as string[],
  };

  // Variables available to all contexts
  const sharedRequiredVars = ["VITE_POSTHOG_API_HOST", "VITE_POSTHOG_API_KEY"];

  return {
    configResolved(config) {
      if (config.mode !== "production") {
        return;
      }

      const contextVars = requiredVarsByContext[context];
      const allRequiredVars = [...sharedRequiredVars, ...contextVars];

      for (const key of allRequiredVars) {
        if (!config.env[key]) {
          throw new Error(
            `Missing environment variable for ${context}: ${key}`,
          );
        }
      }
    },
    name: `validate-production-env:${context}`,
  };
}

export default defineConfig(({ command }) => {
  const require = createRequire(import.meta.url);
  // In dev, ffmpeg-static/ffprobe-static are external but node_modules isn't
  // next to the output, so we resolve and bake in the absolute path. In prod,
  // the packaged app has node_modules alongside the bundle, so a bare specifier
  // resolves correctly.
  const ffmpegStaticValue =
    command === "serve" ? require.resolve("ffmpeg-static") : "ffmpeg-static";
  const ffprobeStaticValue =
    command === "serve"
      ? require.resolve("@derhuerst/ffprobe-static")
      : "@derhuerst/ffprobe-static";
  const agentBrowserBinDir =
    command === "serve"
      ? path.dirname(require.resolve("agent-browser/bin/agent-browser.js"))
      : null;

  const isProduction = command === "build";

  return {
    main: {
      build: {
        // Vite empties outDir on every rebuild, not just the first, and
        // electron-vite's watch hook only restarts the Electron child it
        // spawned itself. A second dev server (or a second Studio instance)
        // in this checkout therefore deletes out/main out from under a live
        // main process, and its next lazily-imported chunk -- most of
        // just-bash's ~170 builtins, plus our own dynamic imports -- dies
        // with ERR_MODULE_NOT_FOUND. Chunk names are content-hashed, so
        // leaving stale files behind is safe; only a build needs a clean dir.
        emptyOutDir: isProduction,
        externalizeDeps: {
          exclude: mainExternalizeExclude,
          include:
            // In dev, we must include all dependencies
            command === "serve"
              ? []
              : monorepoDeps.filter(
                  (dep) => !mainExternalizeExclude.includes(dep),
                ),
        },
        lib: {
          entry: path.join(process.cwd(), "src/electron-main/index.ts"),
        },
        rollupOptions: {
          // node-liblzma and @mongodb-js/zstd are optional dependencies of just-bash that fail to build in CI.
          // @parcel/watcher (and its per-platform native bindings) must load from node_modules at runtime, never bundled.
          external: ["node-liblzma", "@mongodb-js/zstd", /^@parcel\/watcher/],
          onwarn(warning, warn) {
            if (
              warning.code === "UNUSED_EXTERNAL_IMPORT" &&
              warning.message.includes("ZodFirstPartyTypeKind")
            ) {
              // Suppresses "ZodFirstPartyTypeKind" is imported from external module "zod" but never used
              // Due to OpenRouter AI SDK Provider using older Zod
              // Remove this if they update https://github.com/OpenRouterTeam/ai-sdk-provider
              return;
            }
            if (warning.code === "UNRESOLVED_IMPORT") {
              throw new Error(warning.message);
            }
            warn(warning);
          },
        },
        sourcemap: isProduction,
        watch: {}, // Enable hot reloading
      },
      define: {
        __AGENT_BROWSER_BIN_DIR__: JSON.stringify(agentBrowserBinDir),
        __FFMPEG_STATIC_PATH__: JSON.stringify(ffmpegStaticValue),
        __FFPROBE_STATIC_PATH__: JSON.stringify(ffprobeStaticValue),
      },
      plugins: [
        copyVendorAssets(),
        ...(isAnalyzing ? [analyzer({ analyzerMode: "json" })] : []),
        createValidateProductionEnv("main"),
        ValidateEnv({ configFile: "./validate-env" }),
      ],
      resolve,
    },
    preload: {
      build: {
        // Same rebuild-wipe hazard as main: a window or webview created while
        // out/preload is empty gets no preload script at all.
        emptyOutDir: isProduction,
        lib: {
          entry: path.join(process.cwd(), "src/electron-preload/index.ts"),
        },
        sourcemap: isProduction,
        watch: {}, // Enable hot reloading
      },
      plugins: [
        ...(isAnalyzing ? [analyzer({ analyzerMode: "json" })] : []),
        createValidateProductionEnv("preload"),
      ],
      resolve,
    },
    renderer: {
      build: {
        rollupOptions: {
          input: {
            browser: path.join(process.cwd(), "src/index.html"),
          },
        },
        sourcemap: isProduction,
        watch: {}, // Enable hot reloading
      },
      // Each document viewer spawns its parser worker with `new Worker(new
      // URL("./x.js", import.meta.url), { type: "module" })`. Pre-bundling
      // rewrites `import.meta.url` to the dependency cache, where the sibling
      // worker file does not exist, so the dev server answers with the SPA
      // fallback HTML and the worker dies on load. Serving these unbundled
      // lets Vite's worker transform resolve the real entry.
      optimizeDeps: {
        exclude: [
          "@extend-ai/react-docx",
          "@extend-ai/react-pptx",
          "@extend-ai/react-xlsx",
        ],
        // Excluding a package stops its CommonJS-only imports from being
        // converted to ESM, so those are pre-bundled on their own.
        include: [
          // cspell:ignore utif regl
          "@extend-ai/react-docx > utif",
          "@extend-ai/react-pptx > regl",
          "@extend-ai/react-xlsx > regl",
          "react-dom/server",
        ],
      },
      plugins: [
        ...(isAnalyzing ? [analyzer({ analyzerMode: "json" })] : []),
        createValidateProductionEnv("renderer"),
        tanstackRouter({
          autoCodeSplitting: true,
          // Paths are relative to the renderer `root` (`src`) below, not cwd:
          // router-plugin >=1.168 resolves these against Vite's config.root.
          generatedRouteTree: "./client/routeTree.gen.ts",
          routesDirectory: "./client/routes",
        }),
        react({
          babel: {
            plugins: ["babel-plugin-react-compiler"],
          },
        }),
        tailwindcss(),
      ],
      resolve,
      root: path.resolve("src"),
      // The document viewers' parser workers are module workers whose entries
      // code-split, which the default IIFE worker format cannot express, so the
      // build fails without this.
      worker: { format: "es" },
    },
  };
});
