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

// `buildStart` fires on every watch rebuild and the plugin is installed on more
// than one build, so re-copying ~11MB of WASM each time is skipped when the
// destination already holds the current bytes.
async function copyVendorAsset({ from, to }: { from: string; to: string }) {
  const source = await fs.stat(from);
  try {
    const target = await fs.stat(to);
    if (target.size === source.size && target.mtimeMs >= source.mtimeMs) {
      return;
    }
  } catch {
    // No destination yet.
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

function copyVendorAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const resourcesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "resources",
  );
  const wasmDir = path.join(resourcesDir, "wasm");
  // @embedpdf/pdfium is a transitive dependency of @embedpdf/engines, so under
  // pnpm's isolated layout it is only resolvable from the engines package.
  const embedPdfEnginesDir = path.dirname(require.resolve("@embedpdf/engines"));
  const assets = [
    {
      from: require.resolve("@tailwindcss/browser"),
      to: path.join(resourcesDir, "tailwind-browser.js"),
    },
    // The renderer runs from `file://` in production, where `fetch()` of
    // bundled assets is blocked, so these are served over the app protocol
    // from `resources/` instead of being emitted into the renderer bundle.
    {
      from: require.resolve("@embedpdf/pdfium/pdfium.wasm", {
        paths: [embedPdfEnginesDir],
      }),
      to: path.join(wasmDir, "pdfium.wasm"),
    },
    {
      from: require.resolve("@extend-ai/react-docx/docx_wasm_bg.wasm"),
      to: path.join(wasmDir, "docx.wasm"),
    },
    {
      from: require.resolve("@extend-ai/react-pptx/pptx_wasm_bg.wasm"),
      to: path.join(wasmDir, "pptx.wasm"),
    },
    {
      from: require.resolve("@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm"),
      to: path.join(wasmDir, "xlsx.wasm"),
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
          "@extend-ai/react-docx > utif",
          "@extend-ai/react-pptx > regl",
          "@extend-ai/react-xlsx > regl",
          "react-dom/server",
        ],
      },
      plugins: [
        copyVendorAssets(),
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
