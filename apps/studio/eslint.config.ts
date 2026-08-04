import type { ConfigArray } from "@instrument-org/eslint-config/base";

import baseConfig from "@instrument-org/eslint-config/react";
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
        {
          message:
            "TanStack Router's Link is not tab-aware. Use the InternalLink component instead.",
          selector:
            "ImportDeclaration[source.value='@tanstack/react-router'] > ImportSpecifier[imported.name='Link']",
        },
        {
          message:
            "Color and background never ease: a ramp in front of hover or pressed feedback reads as lag. Drop the class so the change lands on the next paint, or name the properties that really move (transition-[transform], transition-[outline]).",
          selector: "Literal[value=/(?:^|\\s)transition-colors(?:\\s|$)/]",
        },
      ],
    },
  },
  {
    // Build-time hooks emit diagnostics to the release logs, same as scripts/.
    files: ["electron-builder/**/*.{js,mjs,ts}"],
    rules: {
      "no-console": "off",
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
    // The syntax bans above describe the shape of the running app: one
    // TooltipProvider at its root, links that know about tabs, no bare anchors.
    // A test mounts a component without that shell and has to supply the pieces
    // itself, so the rule only produced per-file disables there.
    files: ["**/*.test.*"],
    rules: {
      "no-restricted-syntax": "off",
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
