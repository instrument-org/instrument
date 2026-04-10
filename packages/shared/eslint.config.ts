import type { ConfigArray } from "@instrument-org/eslint-config/base";

import baseConfig from "@instrument-org/eslint-config/base";
import { globalIgnores } from "eslint/config";

export default [
  globalIgnores(["coverage", "*.local"]),
  ...baseConfig,
] satisfies ConfigArray;
