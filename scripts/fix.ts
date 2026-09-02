// Applies the automatic fixes that reach every file rather than only the ones a
// session edited.
//
// The editor-agent format hook rewrites what it sees go through an edit tool, so
// anything written another way -- a heredoc, `sed -i`, a generator -- reaches a
// commit unformatted. Formatting is also the one check CI does not gate on, so
// nothing downstream catches it either. This closes that gap in a couple of
// seconds over the whole tree.
//
// Lint fixing sits behind `--lint` because it costs a minute at full CPU: an
// ESLint and a type-aware oxlint per package, on a checkout that usually has
// other agents working in it. The hook already lint-fixes a session's own edits
// and `check:lint` catches whatever it missed, so the sweep is worth paying for
// deliberately, not by default.

import { spawnSync } from "node:child_process";

const FORMAT = { command: "pnpm fix:format", label: "format" };

const PASSES = [
  // Spelling first, so every pass below sees corrected text.
  { command: "pnpm fix:spelling", label: "spelling" },
  FORMAT,
  ...(process.argv.includes("--lint")
    ? [
        {
          command:
            "pnpm exec turbo run fix:lint --continue=dependencies-successful --output-logs errors-only",
          label: "lint",
        },
        // Lint fixes change layout, so format again -- and do it even when lint
        // reports what it could not fix, or the tree is left unformatted.
        { ...FORMAT, label: "format (after lint fixes)" },
      ]
    : []),
];

// pnpm and turbo resolve through shims on Windows, so these go through a shell.
function run({ command, label }: { command: string; label: string }): boolean {
  console.log(`\n> ${label}: ${command}`);
  const { status } = spawnSync(command, { shell: true, stdio: "inherit" });
  return status === 0;
}

const unresolved = PASSES.filter((pass) => !run(pass)).map(
  (pass) => pass.label,
);

if (unresolved.length > 0) {
  console.error(
    `\nStill reporting problems after fixing: ${unresolved.join(", ")}. Resolve what is printed above by hand.`,
  );
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1);
}

console.log("\nEverything fixable is fixed.");
