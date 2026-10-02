import { err, type Result, ResultAsync } from "neverthrow";
import fs from "node:fs";
import path from "node:path";

import { TASKS_DIR_NAME } from "../constants";
import { AbsolutePathSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { chatReadProblem } from "./chat/chats";
import {
  chatsDir,
  forgetChat,
  sessionOfChat,
  storedChatSession,
} from "./record-folders";
import { disposeSessionsStoreStorage } from "./session-store-storage";

interface InvalidChatFolder {
  /** The folder's path under `chats/`: a chat's own, or a task's inside one. */
  name: string;
  reason: string;
}

const REASONS = {
  "no-session": "No chat session in its settings (.instrument/settings.json)",
  "unreadable-messages": "Unreadable messages (.instrument/task.db)",
  "unreadable-session": "Unreadable chat session (.instrument/task.db)",
  "unreadable-settings":
    "Missing or unreadable settings (.instrument/settings.json)",
} as const;

/**
 * Folders under `chats/` that the chat list leaves out: a chat whose folder
 * name is not a record id, whose settings name no session, or whose session
 * or messages cannot be read, and a task inside a chat whose folder name is
 * not a record id. The chat list skips them without a trace, so they are
 * surfaced here for Settings > Storage instead of reported one by one.
 */
export async function listInvalidChatFolders(): Promise<InvalidChatFolder[]> {
  const root = chatsDir();
  const invalid: InvalidChatFolder[] = [];
  for (const name of listDirs(root)) {
    const id = TaskIdSchema.safeParse(name);
    if (!id.success) {
      invalid.push({
        name,
        reason: id.error.issues[0]?.message ?? "Not a recognized chat folder",
      });
      continue;
    }
    const stored = storedChatSession(path.join(root, name));
    if ("problem" in stored) {
      invalid.push({ name, reason: REASONS[stored.problem] });
      continue;
    }
    // The store is reached through the index, which knows the chat by this
    // session once it has read the folder.
    if (sessionOfChat(id.data) === stored.sessionId) {
      const problem = await chatReadProblem(id.data, stored.sessionId);
      if (problem) {
        invalid.push({ name, reason: REASONS[problem] });
        continue;
      }
    }
    for (const taskName of listDirs(path.join(root, name, TASKS_DIR_NAME))) {
      const taskId = TaskIdSchema.safeParse(taskName);
      if (!taskId.success) {
        invalid.push({
          name: path.join(name, TASKS_DIR_NAME, taskName),
          reason:
            taskId.error.issues[0]?.message ?? "Not a recognized task folder",
        });
      }
    }
  }
  return invalid;
}

/**
 * Sends one folder the scan reports to the OS trash. Only a name the scan
 * reports right now is taken, which keeps a chat the list can show, and any
 * path out of `chats/`, out of reach. A chat whose store was opened has it
 * closed first, and leaves the index once its folder is gone.
 */
export async function trashInvalidChatFolder(
  name: string,
  workspaceConfig: WorkspaceConfig,
): Promise<Result<void, TypedError.FileSystem | TypedError.Parse>> {
  const invalid = await listInvalidChatFolders();
  if (!invalid.some((folder) => folder.name === name)) {
    return err(
      new TypedError.Parse(`Not a chat folder the app cannot read: ${name}`),
    );
  }
  const chatId = TaskIdSchema.safeParse(name);
  return ResultAsync.fromPromise(
    (async () => {
      if (chatId.success) {
        const disposed = await disposeSessionsStoreStorage(chatId.data);
        if (disposed.isErr()) {
          throw disposed.error;
        }
      }
      await workspaceConfig.trashItem(
        AbsolutePathSchema.parse(path.join(chatsDir(), name)),
      );
      if (chatId.success) {
        forgetChat(chatId.data);
      }
    })(),
    (error) =>
      new TypedError.FileSystem(
        error instanceof Error ? error.message : "Unknown error",
        { cause: error },
      ),
  );
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
