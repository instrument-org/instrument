import reactPlugin from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

import baseConfig from "./base";

const config: ReturnType<typeof tseslint.config> = tseslint.config(
  ...baseConfig,
  reactPlugin.configs.flat.recommended ?? {},
  {
    plugins: {
      // @ts-expect-error Meta doesn't have a type definition
      "react-hooks": pluginReactHooks,
    },
    rules: {
      // Hooks can occur in TSX and TS files.
      ...pluginReactHooks.configs.recommended.rules,
      // React scope no longer necessary with new JSX transform.
      "react/react-in-jsx-scope": "off",
    },
    settings: { react: { version: "detect" } },
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ...reactPlugin.configs.flat.recommended?.languageOptions,
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // The icon package's root re-exports 3024 separate modules, and
              // importing it evaluates all of them: 914ms in Node, which a
              // bundler amortizes but a test runner pays once per test file,
              // since each one gets its own module registry. A subpath is a
              // leaf and costs ~1ms.
              //
              // `allowTypeImports` because a type-only import is erased before
              // anything runs, so it is free wherever it points. `Icon` and
              // `IconProps` are only reachable from the root, and stay there.
              allowTypeImports: true,
              message:
                "Import the icon from its own module -- `@phosphor-icons/react/Check`, not the package root. The root pulls in every icon there is.",
              regex: "^@phosphor-icons/react$",
            },
          ],
        },
      ],
      "n/no-unsupported-features/node-builtins": [
        "error",
        { allowExperimental: true, ignores: ["localStorage"] },
      ],
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "react/jsx-boolean-value": ["error", "never"], // isActive instead of isActive={true}
      // Ensures we don't use curly braces if not needed in props
      "react/jsx-curly-brace-presence": ["error", { props: "never" }],
      "react/prop-types": "off",
    },
  },
);

export default config;
