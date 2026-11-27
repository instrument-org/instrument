// Fails when what the app loads before its first window grows past its
// budget, or takes in a package that belongs behind a dynamic import. Makes a
// production build and reads the startup manifests it writes
// (`electron-builder/startup-bundle.ts`):
//
//   pnpm --filter @instrument-org/studio check:startup
//
// The build goes to `out/startup-check/`, so a dev instance running from
// `out/` in the same checkout keeps its files.
//
// A budget is raised on purpose, in the change that needs the room, with the
// reason in its commit. A banned package is moved behind an `import()` where
// it is first used rather than unbanned.

import { execFileSync } from "node:child_process";
import path from "node:path";

import { type BundleName } from "../electron-builder/bundled-packages.ts";
import {
  readStartupBundle,
  type StartupBundle,
} from "../electron-builder/startup-bundle.ts";

const STUDIO_DIR = path.resolve(import.meta.dirname, "..");
// Absolute: the renderer's build resolves a relative one against its root.
const OUT_DIR = path.join(STUDIO_DIR, "out", "startup-check");

const MB = 1024 * 1024;

const STARTUP = {
  // Everything main evaluates to start: `boot.ts`, `before-ready.ts` and
  // `index.ts`. just-bash is not banned yet: the workspace's file layers
  // import it throughout.
  main: {
    banned: [
      "@anthropic-ai/claude-agent-sdk",
      "@ghostery/adblocker",
      "@milkdown/crepe",
      "@zip.js/zip.js",
      "katex",
      "node-html-markdown",
      "parse5",
    ],
    budgetBytes: 9.2 * MB,
  },
  // What main evaluates before its first window is up: `boot.ts` and
  // `before-ready.ts`, which settle the workspace's folders and make the
  // window, and none of the agent. Code there imports the workspace from
  // `@instrument-org/workspace/launch` and reaches the rest through
  // `index.ts`, which loads once the window is up.
  "main before-window": {
    banned: ["@modelcontextprotocol/sdk", "ai", "just-bash"],
    budgetBytes: 1.1 * MB,
    hint: "Load it from `index.ts` or with `import()` once the window is up, or import the workspace from `@instrument-org/workspace/launch`.",
  },
  preload: {
    banned: [],
    budgetBytes: 0.05 * MB,
  },
  // Everything a window loads before it can draw.
  renderer: {
    banned: [
      "@anthropic-ai/claude-agent-sdk",
      "@excalidraw/excalidraw",
      "@milkdown/crepe",
      "just-bash",
      "katex",
      "mermaid",
      "pele",
      "prosemirror-view",
    ],
    budgetBytes: 10.85 * MB,
  },
} satisfies Partial<
  Record<
    BundleName | `${BundleName} ${string}`,
    { banned: string[]; budgetBytes: number; hint?: string }
  >
>;

/** What is wrong with one build's startup path, one line per problem. */
export function startupProblems(
  name: string,
  startup: StartupBundle,
  {
    banned,
    budgetBytes,
    hint = "Import it with `import()` where it is first used.",
  }: { banned: string[]; budgetBytes: number; hint?: string },
) {
  const problems: string[] = [];
  if (startup.bytes > budgetBytes) {
    const largest = Object.entries(startup.packages)
      .slice(0, 5)
      .map(([pkg, bytes]) => `${pkg} ${(bytes / MB).toFixed(2)} MB`)
      .join(", ");
    problems.push(
      `${name}: ${(startup.bytes / MB).toFixed(2)} MB loads at startup, over its ${(budgetBytes / MB).toFixed(2)} MB budget. Largest: ${largest}.`,
    );
  }
  const loaded = new Set([
    ...Object.keys(startup.packages),
    ...startup.externals,
  ]);
  for (const pkg of banned) {
    if (loaded.has(pkg)) {
      problems.push(`${name}: ${pkg} loads at startup. ${hint}`);
    }
  }
  return problems;
}

if (import.meta.main) {
  execFileSync("pnpm", ["run", "build", "--outDir", OUT_DIR], {
    cwd: STUDIO_DIR,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  const problems: string[] = [];
  for (const name of Object.keys(STARTUP) as (keyof typeof STARTUP)[]) {
    const limits = STARTUP[name];
    const [bundle, part] = name.split(" ") as [BundleName, string?]; // The keys above.
    const startup = readStartupBundle(bundle, OUT_DIR, part);
    if (!startup) {
      problems.push(
        `${name}: no startup manifest under ${OUT_DIR}. Keep recordStartupBundle("${bundle}") in electron.vite.config.ts.`,
      );
      continue;
    }
    problems.push(...startupProblems(name, startup, limits));
    console.log(
      `${name}: ${(startup.bytes / MB).toFixed(2)} MB of ${(limits.budgetBytes / MB).toFixed(2)} MB at startup, ${startup.files.length} files`,
    );
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
}
