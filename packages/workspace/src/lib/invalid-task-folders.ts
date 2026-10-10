import {
  PRIVATE_FOLDER_NAME,
  SETTINGS_FILE_NAME,
} from "@instrument-org/shared";
import { glob } from "glob";
import { err, type Result, ResultAsync } from "neverthrow";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { AbsolutePathSchema } from "../schemas/paths";
import { ChatIdSchema } from "../schemas/chat-id";
import { ChatSettingsSchema } from "../schemas/chat-settings";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { disposeSessionsStoreStorage } from "./session-store-storage";

interface InvalidTaskFolder {
  name: string;
  reason: string;
}

/** Why a task folder is listed in Settings > Storage when its settings are the trouble. */
export const UNREADABLE_SETTINGS_REASON =
  "Missing or unreadable settings (.instrument/settings.json)";

/**
 * Whether a task folder's settings are missing or cannot be read as a
 * task's: the same test the task record applies, made on the file alone so
 * nothing is opened or written inside the folder.
 */
export function hasReadableTaskSettings(chatDir: string): boolean {
  try {
    return ChatSettingsSchema.safeParse(
      JSON.parse(
        readFileSync(
          path.join(chatDir, PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME),
          "utf8",
        ),
      ),
    ).success;
  } catch {
    return false;
  }
}

// Directories under tasks/ that the task list cannot show: a name that is not a
// valid task id, or settings that are missing or unreadable. These show up when
// a user (or an external tool) manually creates, renames, or edits a folder
// inside the workspace. They are a recoverable, user-visible data condition
// rather than a bug, so the lists skip them silently -- instead of reporting
// one telemetry exception per folder on every scan -- and we surface them here
// for the UI.
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
    const parsed = ChatIdSchema.safeParse(name);
    if (!parsed.success) {
      invalid.push({
        name,
        reason:
          parsed.error.issues[0]?.message ?? "Not a recognized task folder",
      });
    } else if (!hasReadableTaskSettings(path.join(rootDir, name))) {
      invalid.push({ name, reason: UNREADABLE_SETTINGS_REASON });
    }
  }
  return invalid;
}

// Sends a single folder the scan reports to the OS trash. Deliberately narrow:
// it refuses a task the list can show (those go through trashTask) and any
// name that isn't a direct child of tasks/, so it can't be used to traverse out
// of the workspace.
export async function trashInvalidTaskFolder(
  name: string,
  workspaceConfig: WorkspaceConfig,
): Promise<Result<void, TypedError.FileSystem | TypedError.Parse>> {
  if (
    ChatIdSchema.safeParse(name).success &&
    hasReadableTaskSettings(path.join(workspaceConfig.tasksDir, name))
  ) {
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

  const chatId = ChatIdSchema.safeParse(name);
  return ResultAsync.fromPromise(
    (async () => {
      // A store something opened is closed before its folder goes.
      if (chatId.success) {
        const disposed = await disposeSessionsStoreStorage(chatId.data);
        if (disposed.isErr()) {
          throw disposed.error;
        }
      }
      await workspaceConfig.trashItem(AbsolutePathSchema.parse(target));
    })(),
    (error) =>
      new TypedError.FileSystem(
        error instanceof Error ? error.message : "Unknown error",
        { cause: error },
      ),
  );
}
