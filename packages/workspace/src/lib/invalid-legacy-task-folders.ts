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

interface InvalidLegacyTaskFolder {
  name: string;
  reason: string;
}

/** Why a folder is listed in Settings > Storage when its settings are the trouble. */
export const UNREADABLE_SETTINGS_REASON =
  "Missing or unreadable settings (.instrument/settings.json)";

/**
 * Whether a 1.x task folder's settings can be read, made on the file alone
 * so nothing is opened or written inside the folder.
 */
function hasReadableLegacyTaskSettings(taskDir: string): boolean {
  try {
    return ChatSettingsSchema.safeParse(
      JSON.parse(
        readFileSync(
          path.join(taskDir, PRIVATE_FOLDER_NAME, SETTINGS_FILE_NAME),
          "utf8",
        ),
      ),
    ).success;
  } catch {
    return false;
  }
}

// Folders an earlier version left under tasks/ that the 1.x migration could
// not make into chats: a name that is not a record id, or settings that are
// missing or unreadable. Nothing lists them, so they are surfaced here for
// Settings > Storage, where the user can reveal or trash them.
export async function listInvalidLegacyTaskFolders(
  workspaceConfig: WorkspaceConfig,
): Promise<InvalidLegacyTaskFolder[]> {
  const rootDir = workspaceConfig.legacyTasksDir;
  const rootExists = await fs
    .stat(rootDir)
    .then(() => true)
    .catch(() => false);
  if (!rootExists) {
    return [];
  }

  // Only top-level directories, dotfiles excluded.
  const entries = await glob("*/", { cwd: rootDir });
  const invalid: InvalidLegacyTaskFolder[] = [];
  for (const entry of entries) {
    const name = path.basename(entry);
    const parsed = ChatIdSchema.safeParse(name);
    if (!parsed.success) {
      invalid.push({
        name,
        reason:
          parsed.error.issues[0]?.message ?? "Not a recognized task folder",
      });
    } else if (!hasReadableLegacyTaskSettings(path.join(rootDir, name))) {
      invalid.push({ name, reason: UNREADABLE_SETTINGS_REASON });
    }
  }
  return invalid;
}

// Sends a single folder the scan reports to the OS trash. Deliberately narrow:
// it refuses a folder the scan does not report and any name that isn't a
// direct child of tasks/, so it can't be used to traverse out of the
// workspace.
export async function trashInvalidLegacyTaskFolder(
  name: string,
  workspaceConfig: WorkspaceConfig,
): Promise<Result<void, TypedError.FileSystem | TypedError.Parse>> {
  if (
    ChatIdSchema.safeParse(name).success &&
    hasReadableLegacyTaskSettings(
      path.join(workspaceConfig.legacyTasksDir, name),
    )
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

  const tasksDir = path.resolve(workspaceConfig.legacyTasksDir);
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
