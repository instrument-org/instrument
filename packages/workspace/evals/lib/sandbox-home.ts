import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { recordedHome } from "./run-record";

/**
 * Gives the run a home directory of its own, before anything reads one.
 *
 * The chat attaches the user's real home and their real
 * `~/Documents/Instrument` to its conversation, and every task it forks
 * reaches the same folders. Left alone, a suite is several
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

function sandboxHomeDir(): string {
  return (
    process.env.INSTRUMENT_EVAL_HOME ??
    homeOfReportedRun() ??
    path.join(os.tmpdir(), "instrument-eval-home")
  );
}

/**
 * `report <dir>` scores a run whose agents had a home of their own, and an
 * assertion that reads a file it seeded or the agent wrote under that home
 * has to read the same one, or it scores another run's file or none.
 */
function homeOfReportedRun(): string | undefined {
  const args = process.argv.slice(2);
  const dir = args[args.indexOf("report") + 1];
  return args.includes("report") && dir
    ? recordedHome(path.resolve(dir))
    : undefined;
}

const home = sandboxHomeDir();
for (const subfolder of SANDBOX_SUBFOLDERS) {
  fs.mkdirSync(path.join(home, subfolder), { recursive: true });
}
process.env.HOME = home;
process.env.USERPROFILE = home;
