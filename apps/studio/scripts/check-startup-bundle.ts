// Fails when what the app loads before its first window grows past its
// budget, or takes in a package that belongs behind a dynamic import. Reads
// the startup manifests a production build writes
// (`electron-builder/startup-bundle.ts`), so run it after one:
//
//   pnpm --filter @instrument-org/studio check:build
//
// A budget is raised on purpose, in the change that needs the room, with the
// reason in its commit. A banned package is moved behind an `import()` where
// it is first used rather than unbanned.

import path from "node:path";

import { type BundleName } from "../electron-builder/bundled-packages.ts";
import {
  readStartupBundle,
  type StartupBundle,
} from "../electron-builder/startup-bundle.ts";

const OUT_DIR = path.resolve(import.meta.dirname, "..", "out");

const MB = 1024 * 1024;

const STARTUP = {
  // Everything main evaluates before `ready`. just-bash is not banned yet:
  // the workspace's file layers import it throughout.
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
      "prosemirror-view",
    ],
    budgetBytes: 10.8 * MB,
  },
} satisfies Partial<
  Record<BundleName, { banned: string[]; budgetBytes: number }>
>;

/** What is wrong with one build's startup path, one line per problem. */
export function startupProblems(
  name: string,
  startup: StartupBundle,
  { banned, budgetBytes }: { banned: string[]; budgetBytes: number },
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
      problems.push(
        `${name}: ${pkg} loads at startup. Import it with \`import()\` where it is first used.`,
      );
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems: string[] = [];
  for (const name of ["main", "preload", "renderer"] as const) {
    const limits = STARTUP[name];
    const startup = readStartupBundle(name, OUT_DIR);
    if (!startup) {
      problems.push(
        `${name}: no startup manifest under ${OUT_DIR}. Build first (\`pnpm --filter @instrument-org/studio build\`), and keep recordStartupBundle("${name}") in electron.vite.config.ts.`,
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
