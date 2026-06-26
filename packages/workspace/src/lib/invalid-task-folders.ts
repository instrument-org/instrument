import { glob } from "glob";
import { err, type Result, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import path from "node:path";

import { AbsolutePathSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";

export interface InvalidTaskFolder {
  name: string;
  reason: string;
}

// Directories under tasks/ whose name is not a valid task id. These show up when
// a user (or an external tool) manually creates or renames a folder inside the
// workspace. They are a recoverable, user-visible data condition rather than a
// bug, so getTasks skips them silently -- instead of reporting one telemetry
// exception per folder on every scan -- and we surface them here for the UI.
export async function listInvalidTaskFolders(
  workspaceConfig: WorkspaceConfig,
): Promise<InvalidTaskFolder[]> {
  const rootDir = workspaceConfig.tasksDir;
  const rootExists = await fs
    .stat(rootDir)
    .then(() => true)
    .catch(() => false);
  if (!rootExists) {
    return [];
  }

  // Same glob as getTasks: only top-level directories, dotfiles excluded.
  const entries = await glob("*/", { cwd: rootDir });
  const invalid: InvalidTaskFolder[] = [];
  for (const entry of entries) {
    const name = path.basename(entry);
    const parsed = TaskIdSchema.safeParse(name);
    if (!parsed.success) {
      invalid.push({
        name,
        reason:
          parsed.error.issues[0]?.message ?? "Not a recognized task folder",
      });
    }
  }
  return invalid;
}

// Sends a single unrecognized folder to the OS trash. Deliberately narrow: it
// refuses anything that is a valid task id (those go through trashTask) and any
// name that isn't a direct child of tasks/, so it can't be used to traverse out
// of the workspace.
export async function trashInvalidTaskFolder(
  name: string,
  workspaceConfig: WorkspaceConfig,
): Promise<Result<void, TypedError.FileSystem | TypedError.Parse>> {
  if (TaskIdSchema.safeParse(name).success) {
    return err(
      new TypedError.Parse("Refusing to trash a valid task folder this way"),
    );
  }
  if (
    name === "" ||
    name === "." ||
    name === ".." ||
    name !== path.basename(name)
  ) {
    return err(new TypedError.Parse("Invalid folder name"));
  }

  const tasksDir = path.resolve(workspaceConfig.tasksDir);
  const target = path.resolve(tasksDir, name);
  if (path.dirname(target) !== tasksDir) {
    return err(new TypedError.Parse("Folder is outside the tasks directory"));
  }

  return ResultAsync.fromPromise(
    workspaceConfig.trashItem(AbsolutePathSchema.parse(target)),
    (error) =>
      new TypedError.FileSystem(
        error instanceof Error ? error.message : "Unknown error",
        { cause: error },
      ),
  );
}
