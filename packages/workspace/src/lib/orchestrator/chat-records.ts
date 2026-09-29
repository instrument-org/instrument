import path from "node:path";

import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { assignMountNames } from "../assign-mount-names";
import { chatFolderName } from "../generate-task-folder-name";
import { getCurrentDate } from "../get-current-date";
import { initializeTask } from "../initialize-task";
import {
  chatDirs,
  chatOfSession,
  recordIdTaken,
  sessionOfChat,
} from "../record-folders";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";
import { getWorkspaceConfig } from "../workspace-config";
import { ORCHESTRATOR_TITLE, windowTaskId } from "./ensure";

/**
 * A chat's record, made the first time something is sent in it, and named on
 * disk the way a task is: the day it began and a few words of what was asked.
 * It runs the conversation's agent, and it starts with every folder the user
 * has granted any chat, and the window's own, since a grant is the user's
 * answer to "may Instrument reach this" rather than something one chat asked
 * alone. Asked again for the same session, it answers with the chat it made.
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
        kind: "orchestrator",
        name: ORCHESTRATOR_TITLE,
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
  await setTaskState(taskDir(chatId), {
    attachedFolders: await grantedFolders(),
  });
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

/**
 * Every folder granted anywhere in the window, one entry per path at the
 * widest access any chat was given, named the way a new chat would name them.
 */
async function grantedFolders(): Promise<
  Record<string, FolderAttachment.Type>
> {
  const holders = [await windowTaskId(), ...listChatIds()];
  const byPath = new Map<string, FolderAttachment.Type>();
  for (const holder of holders) {
    const state = await getTaskState(taskDir(holder));
    for (const folder of Object.values(state.attachedFolders ?? {})) {
      const known = byPath.get(folder.path);
      if (
        !known ||
        (known.access === "read-only" && folder.access !== "read-only")
      ) {
        byPath.set(folder.path, folder);
      }
    }
  }
  const sorted = [...byPath.values()].toSorted(
    (a, b) => a.createdAt - b.createdAt,
  );
  const names = assignMountNames(sorted);
  return Object.fromEntries(
    sorted.map((folder) => {
      const mountName = names.get(folder.id) ?? folder.mountName;
      return [mountName, { ...folder, mountName }];
    }),
  );
}
