import fs from "node:fs/promises";
import path from "node:path";

import { TASK_FOLDER_NAMES } from "../../constants";
import { type TaskId } from "../../schemas/task-id";
import { taskDir } from "../task-dir-utils";
import { getWorkspaceConfig } from "../workspace-config";
import { type FolderHolding } from "./describe-holdings";

/**
 * Past this the count says "at least" and stops: a task that copied a
 * repository into `work/` has tens of thousands of files there, which is what
 * the number is for, and walking every one of them is not.
 */
const COUNT_CAP = 100_000;

/**
 * What is not the task's own inside its folders: what a package manager or an
 * interpreter put there, a repository's own history, and the copy of a loaded
 * skill, which is the skill's rather than the task's.
 */
const NOT_ITS_OWN = new Set([
  ".git",
  ".pnpm",
  ".venv",
  "__pycache__",
  "node_modules",
]);

/**
 * What a task's folder holds, counted at its top level: each folder with the
 * files under it, and the files at the root, with the scaffold every task
 * starts with left out. A count rather than a listing, because the folder is
 * read for its shape (a repository copied in, a build left behind, nothing at
 * all) and a listing of it would be the thing the note exists to avoid. The
 * orchestrator reads the folder itself when it wants the names.
 */
export async function taskFolderHoldings(
  taskId: TaskId,
): Promise<FolderHolding[]> {
  const root = taskDir(taskId);
  const scaffold = await scaffoldEntries();
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const holdings: FolderHolding[] = [];
  let rootFiles = 0;
  // Alphabetical, so two notes about the same folder read the same way.
  for (const entry of entries.toSorted((a, b) =>
    a.name.localeCompare(b.name, "en-US"),
  )) {
    // Dot entries are the app's and the interpreters' (the task's private
    // folder, tool output, temp files), never something the task made.
    if (entry.name.startsWith(".") || scaffold.has(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      const counted = await countFiles(path.join(root, entry.name), {
        skipTop:
          entry.name === TASK_FOLDER_NAMES.work
            ? new Set([TASK_FOLDER_NAMES.skills])
            : new Set(),
      });
      if (counted.files > 0) {
        holdings.push({
          files: counted.files,
          name: `${entry.name}/`,
          ...(counted.capped ? { capped: true } : {}),
        });
      }
    } else if (entry.isFile()) {
      rootFiles++;
    }
  }
  if (rootFiles > 0) {
    holdings.push({ files: rootFiles, name: "." });
  }
  return holdings;
}

async function countFiles(
  dir: string,
  { skipTop }: { skipTop: Set<string> },
): Promise<{ capped: boolean; files: number }> {
  let files = 0;
  const pending = [{ dir, top: true }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      break;
    }
    let entries;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        NOT_ITS_OWN.has(entry.name) ||
        (current.top && skipTop.has(entry.name))
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        pending.push({ dir: path.join(current.dir, entry.name), top: false });
      } else if (entry.isFile()) {
        files++;
        if (files >= COUNT_CAP) {
          return { capped: true, files };
        }
      }
    }
  }
  return { capped: false, files };
}

async function scaffoldEntries(): Promise<Set<string>> {
  try {
    return new Set(
      await fs.readdir(getWorkspaceConfig().defaultTaskTemplateDir),
    );
  } catch {
    return new Set();
  }
}
