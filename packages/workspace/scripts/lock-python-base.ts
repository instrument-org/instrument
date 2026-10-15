/**
 * Locks `python-base/pyproject.toml` and writes the hash-pinned requirements
 * the app installs from into `src/lib/python-base-requirements.ts`. Run after
 * changing the package list, or the `exclude-newer` date to take newer
 * releases.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const project = path.join(packageDir, "python-base");

await execa("uv", ["lock", "--project", project], { stdio: "inherit" });
const { stdout } = await execa("uv", [
  "export",
  "--project",
  project,
  "--locked",
  "--no-dev",
  "--no-emit-project",
  "--no-header",
  "--no-annotate",
]);

// Written as a raw template literal so a change reads line by line in a diff.
if (stdout.includes("`") || stdout.includes("${")) {
  throw new Error("uv export printed text a template literal cannot hold.");
}
writeFileSync(
  path.join(packageDir, "src/lib/python-base-requirements.ts"),
  `// Written by \`pnpm --filter @instrument-org/workspace script:lock-python-base\`
// from python-base/uv.lock. Do not edit.

export const PYTHON_BASE_REQUIREMENTS = String.raw\`${stdout.trim()}
\`;
`,
);
