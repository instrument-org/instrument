import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const webuiDir = path.dirname(fileURLToPath(import.meta.url));
const studioSrc = path.resolve(webuiDir, "../src");

export default defineConfig({
  plugins: [
    tanstackRouter({
      autoCodeSplitting: true,
      generatedRouteTree: path.join(studioSrc, "client/routeTree.gen.ts"),
      routesDirectory: path.join(studioSrc, "client/routes"),
    }),
    react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
    tailwindcss(),
  ],
  resolve: {
    // Array form: order matters, and the RPC override has to win over the
    // general `@/` prefix rule below it.
    alias: [
      {
        find: /^@\/client\/rpc\/client$/,
        replacement: path.join(webuiDir, "src/mock-rpc.ts"),
      },
      { find: /^@\//, replacement: `${studioSrc}/` },
      {
        find: /^node:crypto$/,
        replacement: path.join(webuiDir, "src/shims/node-crypto.ts"),
      },
    ],
  },
  root: webuiDir,
  server: { port: 5180 },
});
