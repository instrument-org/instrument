import "./types.d.ts";

import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import eslint from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";
import { importX } from "eslint-plugin-import-x";
import jsonc from "eslint-plugin-jsonc";
import n from "eslint-plugin-n";
import oxlint from "eslint-plugin-oxlint";
import "eslint-plugin-only-warn";
import packageJson from "eslint-plugin-package-json/configs/recommended";
import perfectionist from "eslint-plugin-perfectionist";
import * as regexp from "eslint-plugin-regexp";
import turboPlugin from "eslint-plugin-turbo";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import yml from "eslint-plugin-yml";
import globals from "globals";
import path from "node:path";
import tseslint from "typescript-eslint";

export const ERROR_IN_CI = process.env.CI === "true" ? "error" : "off";

export default tseslint.config(
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  eslint.configs.recommended,
  ...jsonc.configs["flat/recommended-with-json"],
  ...yml.configs["flat/recommended"],
  ...yml.configs["flat/prettier"],
  comments.recommended,
  n.configs["flat/recommended"],
  eslintPluginUnicorn.configs["flat/recommended"],
  packageJson,
  perfectionist.configs["recommended-natural"],
  regexp.configs["flat/recommended"],
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    // Type-aware rules run via oxlint (`oxlint --type-aware`, see .oxlintrc.json),
    // which uses typescript-go for near-native speed. ESLint keeps only the
    // syntactic rules, so it no longer builds a TypeScript program.
    extends: [tseslint.configs.strict, tseslint.configs.stylistic],
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parserOptions: {
        // Pin the parser's root dir. Accessing `tseslint.configs.*` registers each
        // loaded eslint.config.ts's directory as a candidate root; when one ESLint
        // server loads several package configs (the editor across the monorepo),
        // the parser sees multiple candidates and throws unless a root is set. No
        // typed linting runs here (type-aware rules live in oxlint), so the exact
        // value is irrelevant -- it only needs to be a stable string.
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        // Required or it can create invalid code
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-namespace": "off", // We use namespaces for organization
      "@typescript-eslint/no-redeclare": "error",
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-use-before-define": [
        "error",
        {
          allowNamedExports: false,
          classes: true,
          enums: true,
          functions: false,
          ignoreTypeReferences: true,
          typedefs: true,
          variables: true,
        },
      ],
      // --------
      // Import X
      // --------
      // Covered by TypeScript, advised to disable by
      // https://typescript-eslint.io/troubleshooting/typed-linting/performance/
      "import-x/default": "off",
      "import-x/named": "off",
      "import-x/namespace": "off",
      "import-x/no-duplicates": "error",
      "import-x/no-named-as-default-member": "off",
      "import-x/no-unresolved": "off",
      // no-cycle and no-named-as-default run always-on via oxlint (import/*),
      // which is fast enough not to gate behind CI.
      "import-x/no-deprecated": "off", // Doesn't support multiple function signatures, so using @typescript-eslint/no-deprecated instead
      // For performance we only run this in CI
      "import-x/no-unused-modules": ERROR_IN_CI,

      // -
      // n
      // -
      "n/no-extraneous-import": "off", // Slow
      "n/no-missing-import": "off", // Covered by TypeScript
      "n/no-unpublished-import": ERROR_IN_CI,
      "n/no-unsupported-features/node-builtins": [
        "error",
        { allowExperimental: true, version: ">=22.5" },
      ],

      // ----
      // Rest
      // ----
      "logical-assignment-operators": [
        "error",
        "always",
        { enforceForIfStatements: true },
      ],
      "no-constant-condition": "off", // covered by @typescript-eslint/no-unnecessary-condition
      // Stylistic concerns that don't interfere with Prettier
      "no-console": "error",
      "no-use-before-define": "off",
      "no-useless-rename": "error",
      "no-warning-comments": ["error", { terms: ["FIXME"] }],
      "object-shorthand": "error",
      "operator-assignment": "error",
      "perfectionist/sort-objects": [
        "error",
        {
          order: "asc",
          partitionByComment: true,
          type: "natural",
        },
      ],
      // Unicorn
      "unicorn/filename-case": [
        "error",
        {
          case: "kebabCase",
          // Dash-prefixed files are convention for ignored files TanStack
          // Router routes directory.
          ignore: ["^-", "README.md"],
        },
      ],
      "unicorn/no-array-callback-reference": "off",
      "unicorn/no-nested-ternary": "off",
      "unicorn/no-null": "off",
      // Re-reads browserslist and package.json per file for ~1.8s a run.
      "unicorn/no-unnecessary-polyfills": "off",
      "unicorn/no-useless-undefined": ["error", { checkArguments: false }],
      "unicorn/prefer-global-this": "off",
      "unicorn/prefer-string-raw": "off",
      "unicorn/prevent-abbreviations": "off",
    },
  },
  {
    files: ["*.jsonc", ".vscode/*.json"],
    rules: {
      "jsonc/comma-dangle": "off",
      "jsonc/no-comments": "off",
      "jsonc/sort-keys": "error",
    },
  },
  {
    files: ["**/.oxlintrc.json"],
    rules: {
      "jsonc/no-comments": "off",
    },
  },
  {
    files: ["**/*.test.*"],
    languageOptions: {
      globals: vitest.environments.env.globals,
    },
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "unicorn/consistent-function-scoping": "off", // Don't care in tests
      "vitest/no-focused-tests": "error",
    },
  },
  {
    files: ["**/*.{yml,yaml}"],
    ignores: [".github/workflows/**/*.yml"],
    rules: {
      "unicorn/prevent-abbreviations": "off",
      "yml/file-extension": ["error", { extension: "yml" }],
      "yml/sort-keys": [
        "error",
        {
          order: { type: "asc" },
          pathPattern: "^.*$",
        },
      ],
      "yml/sort-sequence-values": [
        "error",
        {
          order: { type: "asc" },
          pathPattern: "^.*$",
        },
      ],
    },
  },
  {
    files: ["*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.amd,
      },
      sourceType: "commonjs",
    },
  },
  {
    files: ["**/scripts/**/*.{js,mjs,ts}"],
    rules: {
      "no-console": "off",
    },
  },
  // Disables ESLint rules that impose formatting (e.g. unicorn/template-indent),
  // which would otherwise conflict with the formatter (oxfmt).
  eslintConfigPrettier,
  // Must be last: turns off ESLint's copy of every rule the root
  // .oxlintrc.json already enables, so the two linters don't double-report.
  ...oxlint.buildFromOxlintConfigFile(
    path.join(import.meta.dirname, "../../.oxlintrc.json"),
  ),
);

export type { ConfigArray } from "typescript-eslint";
