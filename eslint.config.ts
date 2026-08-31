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
    ".claude/worktrees",
    "docs/",
  ]),
  ...baseConfig,
  {
    // Dropdown options render in the order they are written, so the reader
    // sees them ranked by how likely each is rather than by spelling.
    files: [
      ".github/ISSUE_TEMPLATE/**/*.yml",
      ".github/DISCUSSION_TEMPLATE/**/*.yml",
    ],
    rules: {
      "yml/sort-sequence-values": "off",
    },
  },
] satisfies ConfigArray;
