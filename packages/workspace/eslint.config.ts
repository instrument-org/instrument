import type { ConfigArray } from "@instrument-org/eslint-config/base";

import baseConfig from "@instrument-org/eslint-config/base";
import { globalIgnores } from "eslint/config";

export default [
  globalIgnores([
    "**/*.snap",
    "coverage",
    "fixtures",
    "*.vitest-temp.json",
    "*.local",
    "templates/default/pnpm-lock.yaml",
    "templates/default/pnpm-workspace.yaml",
  ]),
  ...baseConfig,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      "import-x/no-duplicates": "error",
    },
  },
] satisfies ConfigArray;
