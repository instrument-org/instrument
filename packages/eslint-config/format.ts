import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import eslint from "@eslint/js";
import { importX } from "eslint-plugin-import-x";
import n from "eslint-plugin-n";
import "eslint-plugin-only-warn";
import perfectionist from "eslint-plugin-perfectionist";
import reactPlugin from "eslint-plugin-react";
import globals from "globals";
import tseslint from "typescript-eslint";

// Used by editor/agent format hooks for fast autofixes such as import,
// object, and Tailwind class sorting. Keep this free of typed linting rules so
// one-file formatting does not pay the TypeScript project startup cost.
const config: ReturnType<typeof tseslint.config> = tseslint.config(
  {
    linterOptions: {
      // This config is a subset of the full lint rules. Disable comments for
      // rules that only exist in the main config must not be stripped on --fix.
      reportUnusedDisableDirectives: "off",
    },
  },
  eslint.configs.recommended,
  comments.recommended,
  tseslint.configs.recommended,
  n.configs["flat/recommended"],
  perfectionist.configs["recommended-natural"],
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  reactPlugin.configs.flat.recommended ?? {},
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ...reactPlugin.configs.flat.recommended?.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        projectService: false,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "import-x/default": "off",
      "import-x/named": "off",
      "import-x/namespace": "off",
      "import-x/no-duplicates": "error",
      "import-x/no-named-as-default-member": "off",
      "import-x/no-unresolved": "off",
      "n/no-extraneous-import": "off",
      "n/no-missing-import": "off",
      "n/no-unpublished-import": "off",
      "perfectionist/sort-objects": [
        "error",
        {
          order: "asc",
          partitionByComment: true,
          type: "natural",
        },
      ],
      "react/prop-types": "off",
    },
    settings: {
      react: { version: "19.2" },
    },
  },
  {
    files: ["*.cjs"],
    languageOptions: {
      globals: {
        ...globals.amd,
        ...globals.node,
      },
      sourceType: "commonjs",
    },
  },
);

export default config;
