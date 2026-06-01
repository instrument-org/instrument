import type { ConfigArray } from "@instrument-org/eslint-config/base";

import baseConfig from "@instrument-org/eslint-config/base";
import { globalIgnores } from "eslint/config";

export default [
  globalIgnores([
    "apps",
    "packages",
    ".agents",
    ".cursor/plans",
    ".turbo",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".vite",
    ".tmp",
    "coverage",
    ".next",
    "registry",
  ]),
  ...baseConfig,
  {
    files: [".github/ISSUE_TEMPLATE/**/*.yml"],
    rules: {
      "yml/sort-sequence-values": "off",
    },
  },
] satisfies ConfigArray;
