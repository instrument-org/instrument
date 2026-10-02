import path from "node:path";

import { type StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { chatFolderName } from "../generate-task-folder-name";
import { getCurrentDate } from "../get-current-date";
import { initializeTask } from "../initialize-task";
import {
  chatDirs,
  chatOfSession,
  recordIdTaken,
  sessionOfChat,
} from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { INSTRUMENT_TITLE } from "./ensure";

/**
 * A chat's record, made the first time something is sent in it, and named on
 * disk the way a task is: the day it began and a few words of what was asked.
 * It runs the conversation's agent, and holds only the folders sent in it
 * (what else it reaches is in folder-reach.ts). Asked again for the same
 * session, it answers with the chat it made.
 */
export async function ensureChat(
  sessionId: StoreId.Session,
  firstWords?: string,
): Promise<TaskId> {
  const existing = chatOfSession(sessionId);
  if (existing) {
    return existing;
  }
  const chatId = TaskIdSchema.parse(
    chatFolderName({
      date: getCurrentDate(),
      isTaken: recordIdTaken,
      title: firstWords,
    }),
  );
  const made = await initializeTask(
    {
      initialSettings: {
        chatSessionId: sessionId,
        kind: "chat",
        name: INSTRUMENT_TITLE,
      },
      taskId: chatId,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  if (made.isErr()) {
    // Two sends racing for the same new chat: the other one made it.
    const raced = chatOfSession(sessionId);
    if (raced) {
      return raced;
    }
    throw made.error;
  }
  return chatId;
}

/**
 * Every chat's record id, oldest first: by its session's id, a ULID, which
 * orders to the millisecond where the day in a folder's name does not.
 */
export function listChatIds(): TaskId[] {
  return chatDirs()
    .map((dir) => TaskIdSchema.parse(path.basename(dir)))
    .sort((a, b) =>
      (sessionOfChat(a) ?? "").localeCompare(sessionOfChat(b) ?? ""),
    );
}
