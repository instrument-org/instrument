import type { ConfigArray } from "@instrument-org/eslint-config/base";

import baseConfig from "@instrument-org/eslint-config/base";
import { globalIgnores } from "eslint/config";

import { instrumentPlugin } from "./eslint-rules";

export default [
  globalIgnores([
    "**/*.snap",
    "coverage",
    "fixtures",
    "*.vitest-temp.json",
    "*.local",
    "templates/default/work/pnpm-lock.yaml",
    "templates/default/work/pnpm-workspace.yaml",
  ]),
  ...baseConfig,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      "import-x/no-duplicates": "error",
    },
  },
  {
    // Tests and evals are exempt: an assertion should pin the literal value it
    // expects rather than restate the constant it is checking and agree with
    // itself, and an eval's prompt stands in for a user, who types real paths.
    files: ["src/**/*.ts"],
    ignores: ["**/*.test.ts", "src/mount-points.ts"],
    plugins: { instrument: instrumentPlugin },
    rules: {
      "instrument/no-bare-mount-path": "error",
    },
  },
] satisfies ConfigArray;
