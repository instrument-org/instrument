import { err, type Result, ResultAsync } from "neverthrow";
import fs from "node:fs";
import path from "node:path";

import { TASKS_DIR_NAME } from "../constants";
import { AbsolutePathSchema } from "../schemas/paths";
import { ChatIdSchema } from "../schemas/chat-id";
import { type WorkspaceConfig } from "../types";
import { TypedError } from "./errors";
import { chatReadProblem } from "./chat/chats";
import {
  hasReadableTaskSettings,
  UNREADABLE_SETTINGS_REASON,
} from "./invalid-task-folders";
import {
  chatsDir,
  forgetChat,
  sessionOfChat,
  storedChatSession,
} from "./record-folders";
import { disposeSessionsStoreStorage } from "./session-store-storage";

interface InvalidChatFolder {
  /** A chat's own folder, or a task's inside one. */
  kind: "chat" | "chat-task";
  /** The folder's path under `chats/`. */
  name: string;
  reason: string;
}

const REASONS = {
  "no-session": "No chat session in its settings (.instrument/settings.json)",
  "unreadable-messages": "Unreadable messages (.instrument/chat.db)",
  "unreadable-session": "Unreadable chat session (.instrument/chat.db)",
  "unreadable-settings": UNREADABLE_SETTINGS_REASON,
} as const;

/**
 * Folders under `chats/` that the chat list leaves out: a chat whose folder
 * name is not a record id, whose settings name no session, or whose session
 * or messages cannot be read, and a task inside a chat whose folder name is
 * not a record id or whose settings are missing or unreadable. The lists skip
 * them without a trace, so they are surfaced here for Settings > Storage
 * instead of reported one by one.
 */
export async function listInvalidChatFolders(): Promise<InvalidChatFolder[]> {
  const root = chatsDir();
  const invalid: InvalidChatFolder[] = [];
  for (const name of listDirs(root)) {
    const id = ChatIdSchema.safeParse(name);
    if (!id.success) {
      invalid.push({
        kind: "chat",
        name,
        reason: id.error.issues[0]?.message ?? "Not a recognized chat folder",
      });
      continue;
    }
    const stored = storedChatSession(path.join(root, name));
    if ("problem" in stored) {
      invalid.push({ kind: "chat", name, reason: REASONS[stored.problem] });
      continue;
    }
    // The store is reached through the index, which knows the chat by this
    // session once it has read the folder.
    if (sessionOfChat(id.data) === stored.sessionId) {
      const problem = await chatReadProblem(id.data, stored.sessionId);
      if (problem) {
        invalid.push({ kind: "chat", name, reason: REASONS[problem] });
        continue;
      }
    }
    const tasksDir = path.join(root, name, TASKS_DIR_NAME);
    for (const taskName of listDirs(tasksDir)) {
      const chatId = ChatIdSchema.safeParse(taskName);
      const reason = chatId.success
        ? hasReadableTaskSettings(path.join(tasksDir, taskName))
          ? undefined
          : UNREADABLE_SETTINGS_REASON
        : (chatId.error.issues[0]?.message ?? "Not a recognized task folder");
      if (reason) {
        invalid.push({
          kind: "chat-task",
          name: path.join(name, TASKS_DIR_NAME, taskName),
          reason,
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
  // A chat's own folder is named by its id; a task's inside one ends in its.
  const isChatTask = name.includes(path.sep);
  const recordId = ChatIdSchema.safeParse(
    isChatTask ? path.basename(name) : name,
  );
  return ResultAsync.fromPromise(
    (async () => {
      if (recordId.success) {
        const disposed = await disposeSessionsStoreStorage(recordId.data);
        if (disposed.isErr()) {
          throw disposed.error;
        }
      }
      await workspaceConfig.trashItem(
        AbsolutePathSchema.parse(path.join(chatsDir(), name)),
      );
      if (recordId.success) {
        forgetChat(recordId.data);
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
