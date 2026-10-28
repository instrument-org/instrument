import { APP_NAME_SLUG } from "@instrument-org/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Fixtures and scratch a run or case leaves in the temp folder, by name
 * prefix, which nothing reads after a day.
 */
const SCRATCH_PREFIXES = [
  `${APP_NAME_SLUG}-eval-folders-`,
  "activity-grouping-",
  "git-over-mounts-",
  "perm-drive-",
  "perm-evals-",
];

/**
 * A run's workspace and home, which hold what its agents did: kept a month
 * for rescoring with `report` and reading what was made, with the runtime of
 * a run that never removed its own (one that crashed, or ran with
 * `--keep-workspace`) stripped after a day.
 */
const WORKSPACE_PREFIX = `${APP_NAME_SLUG}-evals-`;
const HOME_PREFIX = `${APP_NAME_SLUG}-eval-home-`;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_RUNS_MS = 30 * DAY_MS;

export function sweepOldRuns() {
  const tmp = os.tmpdir();
  const now = Date.now();
  for (const name of fs.readdirSync(tmp)) {
    const dir = path.join(tmp, name);
    try {
      const age = now - fs.statSync(dir).mtimeMs;
      if (SCRATCH_PREFIXES.some((prefix) => name.startsWith(prefix))) {
        if (age > DAY_MS) {
          fs.rmSync(dir, { force: true, recursive: true });
        }
      } else if (
        name.startsWith(WORKSPACE_PREFIX) ||
        name.startsWith(HOME_PREFIX)
      ) {
        if (age > KEEP_RUNS_MS) {
          fs.rmSync(dir, { force: true, recursive: true });
        } else if (age > DAY_MS && name.startsWith(WORKSPACE_PREFIX)) {
          fs.rmSync(path.join(dir, "runtime"), {
            force: true,
            recursive: true,
          });
        }
      }
    } catch {
      // Another run removing the same folder, or one still being written.
    }
  }
}
