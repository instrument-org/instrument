// Makes this checkout runnable, whatever state it is in: the step every
// command a person runs from the root takes first (`pnpm studio`, `pnpm sync`),
// and the one the agents' worktree hook takes too, so there is one answer to
// "what does a checkout need" and nobody has to remember it.
//
// Idempotent and quick when nothing has changed (about a second, nearly all of
// it pnpm confirming the install):
//
// 1. apps/studio/.env.local from its example, when there is none.
// 2. Submodules (registry/) at the commits this checkout records, when one is
//    missing or elsewhere: after a pull, the pointer moves and the folder
//    does not.
// 3. Dependencies, by `pnpm install` every time: it is the only check that
//    cannot be fooled by state files left from another branch.
// 4. The Mac bridge, when it is missing or older than its sources.
//
//   node scripts/prepare.ts

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function say(line: string) {
  process.stdout.write(`[prepare] ${line}\n`);
}

const envLocal = path.join(root, "apps/studio/.env.local");
if (!existsSync(envLocal)) {
  copyFileSync(path.join(root, "apps/studio/.env.local.example"), envLocal);
  say("made apps/studio/.env.local from its example");
}

// A line starting `-` is a submodule never checked out, `+` one at another
// commit than the one recorded.
const stale = execFileSync(
  "git",
  ["-C", root, "submodule", "status", "--recursive"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter((line) => line.startsWith("-") || line.startsWith("+"));
if (stale.length > 0) {
  say("updating submodules");
  try {
    execFileSync(
      "git",
      ["-C", root, "submodule", "update", "--init", "--recursive"],
      { stdio: "inherit" },
    );
  } catch {
    say(
      "submodules did not update (offline, or local changes in one); skills may be missing",
    );
  }
}

try {
  execFileSync("pnpm", ["install", "--prefer-offline"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
} catch {
  say("pnpm install failed; its error is above");
  process.exit(1);
}

// Run as a process of its own, so this script imports nothing from apps/.
execFileSync(
  process.execPath,
  [path.join(root, "apps/studio/scripts/mac-bridge.ts")],
  { stdio: "inherit" },
);
