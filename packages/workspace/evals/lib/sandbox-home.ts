import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Gives the run a home directory of its own, before anything reads one.
 *
 * The orchestrator attaches the user's real home and their real
 * `~/Documents/Instrument` to its conversation, and `task new` hands that same
 * workspace folder to every task it starts. Left alone, a suite is several
 * agents at once holding read-write on the developer's actual files, one
 * runaway model away from deleting work that has no other copy -- and the
 * results are wrong besides, since each run sees what the others just wrote.
 *
 * `os.homedir()` reads `$HOME` on POSIX and `%USERPROFILE%` on Windows, so
 * pointing those at a temp directory redirects every consumer at once, product
 * code included, without a seam the product has to carry for the tests' sake.
 * The folders inside it are the ones a prompt is likely to name.
 */
const SANDBOX_SUBFOLDERS = [
  "Desktop",
  "Documents",
  "Documents/Instrument",
  "Downloads",
];

export function sandboxHomeDir(): string {
  return (
    process.env.INSTRUMENT_EVAL_HOME ??
    path.join(os.tmpdir(), "instrument-eval-home")
  );
}

const home = sandboxHomeDir();
for (const subfolder of SANDBOX_SUBFOLDERS) {
  fs.mkdirSync(path.join(home, subfolder), { recursive: true });
}
process.env.HOME = home;
process.env.USERPROFILE = home;
