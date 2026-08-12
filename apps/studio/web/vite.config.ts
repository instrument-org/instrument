import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const studioSrc = path.resolve(webDir, "../src");

export default defineConfig({
  // Mirrors the renderer config in `electron.vite.config.ts`; see the comments
  // there for why each entry is needed. The document viewers reach the same
  // parser workers in either build.
  optimizeDeps: {
    exclude: [
      "@extend-ai/react-docx",
      "@extend-ai/react-pptx",
      "@extend-ai/react-xlsx",
    ],
    include: [
      "@extend-ai/react-docx > utif",
      "@extend-ai/react-pptx > regl",
      "@extend-ai/react-xlsx > regl",
      "react-dom/server",
    ],
  },
  plugins: [
    tanstackRouter({
      autoCodeSplitting: true,
      generatedRouteTree: path.join(studioSrc, "client/routeTree.gen.ts"),
      routesDirectory: path.join(studioSrc, "client/routes"),
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    // Array form: order matters, and the RPC override has to win over the
    // general `@/` prefix rule below it.
    alias: [
      {
        find: /^@\/client\/rpc\/client$/,
        replacement: path.join(webDir, "src/mock-rpc.ts"),
      },
      { find: /^@\//, replacement: `${studioSrc}/` },
      {
        find: /^node:crypto$/,
        replacement: path.join(webDir, "src/shims/node-crypto.ts"),
      },
    ],
  },
  root: webDir,
  server: { port: 5180 },
  worker: { format: "es" },
});
