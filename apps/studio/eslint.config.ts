import type { ConfigArray } from "@instrument-org/eslint-config/base";

import baseConfig from "@instrument-org/eslint-config/react-with-tailwind";
import { globalIgnores } from "eslint/config";

export default [
  globalIgnores([
    "**/*.snap",
    "*.local",
    "src/client/routeTree.gen.ts",
    "electron.vite.config.*.mjs", // Temporary files created by Vite
    ".vite",
    "coverage",
    "out",
    "fixtures",
    "templates",
    "dist",
    "bin",
    ".tmp",
    "resources/tailwind-browser.js",
  ]),
  ...baseConfig,
  {
    settings: {
      "better-tailwindcss": {
        entryPoint: "./src/client/styles/app.css",
      },
    },
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          message:
            "window.open is not allowed in the Electron app. Use shell.openExternal or ExternalLink component instead.",
          object: "window",
          property: "open",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          message:
            "Raw anchor tags <a> are not allowed the Electron app. Use ExternalLink component instead.",
          selector: "JSXOpeningElement[name.name='a']",
        },
        {
          message:
            "TooltipProvider should only be declared once at the app root. Do not use it in other components.",
          selector: "JSXOpeningElement[name.name='TooltipProvider']",
        },
      ],
    },
  },
  {
    files: ["src/{client,shared}/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          message: "@instrument-org/merge-generators cannot run on the client",
          name: "@instrument-org/merge-generators",
        },
        {
          message:
            "@instrument-org/workspace/electron cannot run on the client",
          name: "@instrument-org/workspace/electron",
        },
        {
          message:
            "@instrument-org/workspace/for-shim is not intended for the Studio",
          name: "@instrument-org/workspace/for-shim",
        },
        {
          message: "@instrument-org/ai-gateway cannot run on the client",
          name: "@instrument-org/ai-gateway",
        },
      ],
    },
  },
  {
    files: ["src/{electron-main,electron-preload}/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          message:
            "@instrument-org/workspace/client is only intended for the client",
          name: "@instrument-org/workspace/client",
        },
        {
          message:
            "@instrument-org/ai-gateway/client is only intended for the client",
          name: "@instrument-org/ai-gateway/client",
        },
      ],
    },
  },
] satisfies ConfigArray;
