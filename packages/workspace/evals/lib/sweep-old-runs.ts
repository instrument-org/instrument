import { APP_NAME_SLUG } from "@instrument-org/shared";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every temp folder an eval run or case leaves behind, by name prefix. Runs keep
 * their workspace so a transcript's files can be inspected afterwards; a day is
 * long enough for that, and without a sweep they fill the disk.
 */
const PREFIXES = [
  `${APP_NAME_SLUG}-evals-`,
  `${APP_NAME_SLUG}-eval-folders-`,
  "activity-grouping-",
  "git-over-mounts-",
  "perm-drive-",
  "perm-evals-",
];

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function sweepOldRuns() {
  const tmp = os.tmpdir();
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const name of fs.readdirSync(tmp)) {
    if (!PREFIXES.some((prefix) => name.startsWith(prefix))) {
      continue;
    }
    const dir = path.join(tmp, name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) {
        fs.rmSync(dir, { force: true, recursive: true });
      }
    } catch {
      // Another run removing the same folder, or one still being written.
    }
  }
}

/**
 * The skills' virtual environments, rebuilt by every run and most of its size,
 * go as soon as the report is written.
 */
export function removePreparedSkills(workspaceRootDir: string) {
  fs.rmSync(path.join(workspaceRootDir, "prepared-skills"), {
    force: true,
    recursive: true,
  });
}
