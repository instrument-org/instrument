import "./eval-tmpdir";

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

/**
 * A home of this run's own, unless it was given one.
 *
 * Made fresh rather than named once and reused: an assertion that reads what
 * the agent wrote under the home would otherwise read what an earlier run
 * wrote there, and pass without the agent having done anything. That is not
 * hypothetical — `work-folder-output` looks for a CSV in the output folder,
 * and every run after the first found the one before it.
 */
function sandboxHomeDir(): string {
  return (
    process.env.INSTRUMENT_EVAL_HOME ??
    homeOfReportedRun() ??
    fs.mkdtempSync(path.join(os.tmpdir(), "instrument-eval-home-"))
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
// Named in the environment so a process this one starts reads the same home
// rather than making one of its own, which a fresh default would otherwise do
// for every child. The run records it too, which is how `report` finds it.
process.env.INSTRUMENT_EVAL_HOME = home;
for (const subfolder of SANDBOX_SUBFOLDERS) {
  fs.mkdirSync(path.join(home, subfolder), { recursive: true });
}
process.env.HOME = home;
process.env.USERPROFILE = home;
