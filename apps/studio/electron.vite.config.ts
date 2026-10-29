import type { Plugin } from "vite";

import { ValidateEnv } from "@julr/vite-plugin-validate-env";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as viteBuild } from "vite";
import { analyzer } from "vite-bundle-analyzer";

import { recordBundledPackages } from "./electron-builder/bundled-packages";
import { contentSecurityPolicyMeta } from "./src/content-security-policy";

const isAnalyzing = process.env.ANALYZE_BUILD === "true";

// electron-vite's dev watcher does two destructive things on a rebuild: a main
// rebuild hard-kills the Electron child and starts a new one, and a preload
// rebuild sends the renderer a full reload, which takes every task's `<webview>`
// and the agent-browser sessions attached to it. Neither waits for a graceful
// teardown, and in a checkout where several agents write at once, either can
// fire on an edit the instance being driven knows nothing about.
//
// Set on an instance that is being driven, so its main and preload stay at the
// bytes they booted with and only a deliberate restart changes them. The
// renderer keeps its dev server and its HMR either way: that is the half worth
// having, and it costs component state rather than the process.
const freezeNative = process.env.DISABLE_DEV_RELAUNCH === "true";

// electron-vite passes `--remote-debugging-port` to the Electron child only
// when this is set, so without a default a hand-started dev instance has no
// debug endpoint and cannot be driven or handed to an agent. Defaulted here
// rather than in the `dev` script because `cross-env` assigns unconditionally,
// and callers that pick their own port (the Windows host runs both of its
// targets through `pnpm run dev`) have to keep it.
process.env.REMOTE_DEBUGGING_PORT ??= "48160";

const monorepoNamespace = "@instrument-org";
// Not including "components" it will be bundled by default in the client
const monorepoPackages = ["workspace", "shared", "ai-gateway"];

// What main loads from node_modules in a packaged app instead of carrying in
// its bundle: packages that find their own binaries, workers or WASM beside
// themselves at runtime, and `ws`, whose native speedups are optional
// requires. Everything else the monorepo packages use is bundled, since a
// launch otherwise spends most of main's startup resolving modules.
const mainKeepsExternal = [
  "@anthropic-ai/claude-agent-sdk",
  "@vscode/ripgrep",
  "agent-browser",
  "dugite",
  "ffmpeg-ffprobe-static",
  "just-bash",
  // Loads its native addon by a path relative to its own files.
  "velopack",
  "ws",
];

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

// A preview build's name, inlined everywhere the shared constants are bundled:
// the renderer has no `process` to read it from, and the packaged app has no
// build environment.
const previewDefine = {
  "process.env.INSTRUMENT_PREVIEW_NAME": JSON.stringify(
    process.env.INSTRUMENT_PREVIEW_NAME ?? "",
  ),
};

let stagingCounter = 0;

/**
 * The page editor's two guest files, built beside main: the preload every
 * browser guest gets (sandboxed, so one CommonJS file with nothing but
 * `electron` left to require) and the editor bundle it evaluates in the
 * guest's isolated world when a page's file is being edited (one IIFE, since
 * it arrives as text over IPC). Registered on the main build, which every
 * dev and build invocation runs; main reads both from `out/page-editor`.
 */
function buildPageEditorGuest({
  minify,
  record,
}: {
  minify: boolean;
  record: boolean;
}): Plugin {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(root, "out/page-editor");
  const guestDir = path.join(root, "src/page-editor-guest");
  const common = {
    configFile: false as const,
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        minify ? "production" : "development",
      ),
    },
    logLevel: "warn" as const,
    resolve,
    root,
  };
  return {
    async buildStart() {
      await viteBuild({
        ...common,
        build: {
          emptyOutDir: false,
          lib: {
            entry: path.join(guestDir, "preload.ts"),
            fileName: () => "preload.cjs",
            formats: ["cjs"],
          },
          minify,
          outDir,
          rollupOptions: { external: ["electron"] },
        },
        plugins: record ? [recordBundledPackages("page-editor-preload")] : [],
      });
      await viteBuild({
        ...common,
        build: {
          emptyOutDir: false,
          lib: {
            entry: path.join(guestDir, "editor/index.ts"),
            fileName: () => "guest.js",
            formats: ["iife"],
            name: "instrumentPageEditor",
          },
          minify,
          outDir,
        },
        plugins: record ? [recordBundledPackages("page-editor-guest")] : [],
      });
    },
    name: "page-editor-guest",
  };
}

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

const resourcesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "resources",
);

// The document viewers' engines, served over the app protocol's vendor host
// from `resources/vendor/` (`client/lib/document-viewers.ts`), by source.
function viewerWasm() {
  const require = createRequire(import.meta.url);
  const vendorDir = path.join(resourcesDir, "vendor");
  return [
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
}

// Registered on the main build alone. Every `electron-vite dev` and `build`
// invocation builds main, and the destinations are read by the main process, so
// a second registration would only add copies racing each other.
function copyVendorAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const assets = [
    {
      from: require.resolve("@tailwindcss/browser"),
      to: path.join(resourcesDir, "tailwind-browser.js"),
    },
    ...viewerWasm(),
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
 * Drops the renderer's own copies of the viewer engines. Each library falls
 * back to `new URL("…wasm", import.meta.url)`, so the build emits its wasm
 * into the renderer's assets, but every viewer is handed the vendor host's
 * copy before it parses (`client/lib/document-viewers.ts`), workers included,
 * so the emitted ones are never fetched. Only an asset byte-identical to a
 * vendored engine goes. Registered on the renderer and its workers, since
 * either can emit one.
 */
function dropViewerWasmCopies(): Plugin {
  let engines: Buffer[] | undefined;
  return {
    apply: "build",
    enforce: "post",
    async generateBundle(_options, bundle) {
      engines ??= await Promise.all(
        viewerWasm().map(({ from }) => fs.readFile(from)),
      );
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "asset" || !fileName.endsWith(".wasm")) {
          continue;
        }
        const source = Buffer.from(output.source);
        if (engines.some((engine) => engine.equals(source))) {
          delete bundle[fileName];
        }
      }
    },
    name: "drop-viewer-wasm-copies",
  };
}

const EXCALIDRAW_ASSETS = "excalidraw-assets";
// The CJK hand-drawn face is 12 MB of the 13; without it, Chinese and
// Japanese text in a drawing falls back to a system font.
const EXCALIDRAW_SKIPPED_FONTS = new Set(["Xiaolai"]);

/**
 * Excalidraw's fonts, served from the renderer's own origin under
 * `/excalidraw-assets/fonts/`, where `window.EXCALIDRAW_ASSET_PATH` points
 * (`client/components/file-viewer.tsx`): the dev server answers from the
 * package, and a build emits them beside the bundle. Its default is a CDN,
 * which `font-src 'self'` refuses.
 */
function excalidrawFonts(): Plugin {
  const require = createRequire(import.meta.url);
  const fontsDir = path.join(
    path.dirname(require.resolve("@excalidraw/excalidraw")),
    "fonts",
  );
  const fontFiles = async () => {
    const files: string[] = [];
    for (const family of await fs.readdir(fontsDir)) {
      if (EXCALIDRAW_SKIPPED_FONTS.has(family)) {
        continue;
      }
      for (const name of await fs.readdir(path.join(fontsDir, family))) {
        if (name.endsWith(".woff2")) {
          files.push(`${family}/${name}`);
        }
      }
    }
    return files;
  };
  return {
    configureServer(server) {
      const prefix = `/${EXCALIDRAW_ASSETS}/fonts/`;
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split("?")[0] ?? "";
        const relative = url.startsWith(prefix) ? url.slice(prefix.length) : "";
        if (!/^\w+\/[\w.-]+\.woff2$/.test(relative)) {
          next();
          return;
        }
        fs.readFile(path.join(fontsDir, relative)).then(
          (bytes) => {
            response.setHeader("Content-Type", "font/woff2");
            response.end(bytes);
          },
          () => {
            response.statusCode = 404;
            response.end();
          },
        );
      });
    },
    async generateBundle() {
      for (const file of await fontFiles()) {
        this.emitFile({
          fileName: `${EXCALIDRAW_ASSETS}/fonts/${file}`,
          source: await fs.readFile(path.join(fontsDir, file)),
          type: "asset",
        });
      }
    },
    name: "excalidraw-fonts",
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
    main: [] as string[],
    preload: [] as string[],
    renderer: [] as string[],
  };

  return {
    configResolved(config) {
      if (config.mode !== "production") {
        return;
      }

      for (const key of requiredVarsByContext[context]) {
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

// react-xlsx parses a workbook's XML in its worker only when `DOMParser`
// exists there, which it never does in a worker. This prepends the module that
// supplies one to the worker's entry, in dev (where the worker is served as a
// module) and in the build (where it is bundled through `worker.plugins`).
function xlsxWorkerDom(): Plugin {
  const shim = path.resolve(
    "src/client/components/document-viewers/xlsx-worker-dom.ts",
  );
  return {
    name: "xlsx-worker-dom",
    transform(code, id) {
      if (!/@extend-ai[/\\]react-xlsx[/\\]dist[/\\]xlsx-worker\.js$/.test(id)) {
        return null;
      }
      return { code: `import ${JSON.stringify(shim)};\n${code}`, map: null };
    },
  };
}

// just-bash starts its `sqlite3` WebAssembly runtime in a worker it finds
// beside its own module (`sqlite3-worker.js`), so it has to run from its own
// package folder. The build externalizes it with the
// rest of the monorepo's dependencies; dev bundles those into out/main, where
// the worker file does not exist and every run waits out the script timeout
// without a word. Dev externalizes it at its resolved path instead, since
// nothing under node_modules next to out/main can resolve the bare name.
function externalizeJustBashInDev(): Plugin {
  return {
    enforce: "pre",
    name: "externalize-just-bash-in-dev",
    async resolveId(source, importer, options) {
      if (source !== "just-bash") return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      // As a file URL: Node's ESM loader takes a POSIX path as one, but reads
      // a Windows path's drive letter as a URL scheme and refuses to load it.
      return (
        resolved && {
          external: true,
          id: pathToFileURL(resolved.id).href,
        }
      );
    },
  };
}

export default defineConfig(({ command }) => {
  const require = createRequire(import.meta.url);
  // In dev, ffmpeg-ffprobe-static is external but node_modules isn't next to
  // the output, so we resolve and bake in the absolute path. In prod, the
  // packaged app has node_modules alongside the bundle, so a bare specifier
  // resolves correctly.
  const ffmpegFfprobeStaticValue =
    command === "serve"
      ? require.resolve("ffmpeg-ffprobe-static")
      : "ffmpeg-ffprobe-static";
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
            command === "serve" ? [] : mainKeepsExternal,
        },
        lib: {
          // `boot.ts` turns on the compile cache before it loads `index.ts`,
          // and is what `out/main/index.js` (package.json's `main`) runs.
          entry: {
            index: path.join(process.cwd(), "src/electron-main/boot.ts"),
            // The Mac apps' MCP server, which the app runs as Node by its
            // own executable (`macAppsServerPath`), as its own file.
            "mac-apps-server": createRequire(import.meta.url).resolve(
              "@instrument-org/workspace/mac-apps-server",
            ),
          },
        },
        rollupOptions: {
          // node-liblzma and @mongodb-js/zstd are optional dependencies of just-bash that fail to build in CI.
          external: ["node-liblzma", "@mongodb-js/zstd"],
          // Rolldown's default region comments name each module by id, and a
          // `?nodeWorker` import's id carries its importer's absolute path,
          // which would ship the build machine's checkout path in the bundle.
          experimental: { attachDebugInfo: "none" },
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
        watch: freezeNative ? null : {}, // Rebuild and relaunch on a source change
      },
      define: {
        ...previewDefine,
        // TEST SEAM: a Windows build made with this set reads its Velopack
        // feed there (a folder or a URL) instead of the releases bucket's, so
        // the update and the move from NSIS can run against a local feed on a
        // test host. A release is built without it.
        "process.env.INSTRUMENT_VELOPACK_FEED_URL": JSON.stringify(
          process.env.INSTRUMENT_VELOPACK_FEED_URL ?? "",
        ),
        __AGENT_BROWSER_BIN_DIR__: JSON.stringify(agentBrowserBinDir),
        __FFMPEG_FFPROBE_STATIC_PATH__: JSON.stringify(
          ffmpegFfprobeStaticValue,
        ),
      },
      plugins: [
        ...(command === "serve" ? [externalizeJustBashInDev()] : []),
        copyVendorAssets(),
        buildPageEditorGuest({ minify: isProduction, record: isProduction }),
        ...(isProduction ? [recordBundledPackages("main")] : []),
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
        watch: freezeNative ? null : {}, // Rebuild and full-reload the renderer on a source change
      },
      plugins: [
        ...(isAnalyzing ? [analyzer({ analyzerMode: "json" })] : []),
        createValidateProductionEnv("preload"),
        ...(isProduction ? [recordBundledPackages("preload")] : []),
      ],
      define: previewDefine,
      resolve,
    },
    renderer: {
      define: previewDefine,
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
          "@xmldom/xmldom",
          "react-dom/server",
        ],
        rolldownOptions: {
          // Dependencies like TanStack Router open their files with "use
          // client", which only means something to React Server Components.
          // The optimizer only bundles dependencies, so dropping it is safe.
          onwarn(warning, warn) {
            if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
              return;
            }
            warn(warning);
          },
        },
      },
      plugins: [
        ...(isAnalyzing ? [analyzer({ analyzerMode: "json" })] : []),
        createValidateProductionEnv("renderer"),
        contentSecurityPolicyMeta({
          previewName: process.env.INSTRUMENT_PREVIEW_NAME,
        }),
        tanstackRouter({
          autoCodeSplitting: true,
          // Paths are relative to the renderer `root` (`src`) below, not cwd:
          // router-plugin >=1.168 resolves these against Vite's config.root.
          generatedRouteTree: "./client/routeTree.gen.ts",
          routesDirectory: "./client/routes",
        }),
        react(),
        babel({ presets: [reactCompilerPreset()] }),
        tailwindcss(),
        xlsxWorkerDom(),
        dropViewerWasmCopies(),
        excalidrawFonts(),
        ...(isProduction ? [recordBundledPackages("renderer")] : []),
      ],
      resolve,
      root: path.resolve("src"),
      // Just the entry, deliberately. The dev server transforms on one thread,
      // and its head start on the renderer is shorter than a wide warmup list
      // takes to drain -- so warming the route modules as well pushes the
      // request for index.html itself behind the queue, and the window paints
      // about a second later than with no warmup at all. Warming the entry
      // alone stays inside the head start and is ahead on every measure.
      server: {
        warmup: {
          clientFiles: ["./client/main.tsx"],
        },
      },
      // The document viewers' parser workers are module workers whose entries
      // code-split, which the default IIFE worker format cannot express, so the
      // build fails without this.
      worker: {
        format: "es",
        plugins: () => [xlsxWorkerDom(), dropViewerWasmCopies()],
      },
    },
  };
});
