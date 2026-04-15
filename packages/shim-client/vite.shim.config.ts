import {
  SHIM_IFRAME_BASE_PATH,
  SHIM_SCRIPTS,
} from "@instrument-org/workspace/for-shim";
import { defineConfig } from "vite";

export default defineConfig({
  base: SHIM_IFRAME_BASE_PATH,
  build: {
    emptyOutDir: false,
    rollupOptions: {
      input: { shim: "./src/client/index.ts" },
      output: { entryFileNames: "[name].js" },
    },
  },
  plugins: [
    {
      generateBundle(_options, bundle) {
        const jsFiles = Object.keys(bundle).filter(
          (fileName) =>
            fileName.endsWith(".js") && bundle[fileName]?.type === "chunk",
        );
        const unexpected = jsFiles.filter((f) => f !== SHIM_SCRIPTS.shimJS);
        if (unexpected.length > 0) {
          throw new Error(
            `Build failed: Unexpected JS files found: ${unexpected.join(", ")}. Only ${SHIM_SCRIPTS.shimJS} is allowed.`,
          );
        }
        if (!jsFiles.includes(SHIM_SCRIPTS.shimJS)) {
          throw new Error(
            `Build failed: Missing expected JS file: ${SHIM_SCRIPTS.shimJS}`,
          );
        }
      },
      name: "validate-javascript-files",
    },
  ],
});
