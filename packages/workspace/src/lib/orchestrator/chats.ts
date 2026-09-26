import path from "node:path";

import { isChatId } from "../../schemas/chat-id";
import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { assignMountNames } from "../assign-mount-names";
import { initializeTask } from "../initialize-task";
import { chatDirs } from "../record-folders";
import { taskDir } from "../task-dir-utils";
import { getTaskState, setTaskState } from "../task-record";
import { getTaskSettings } from "../task-settings";
import { getWorkspaceConfig } from "../workspace-config";
import { ORCHESTRATOR_TITLE, windowTaskId } from "./ensure";

/**
 * A chat's record, made the first time something is sent in it. It runs the
 * conversation's agent, and it starts with every folder the user has granted
 * any chat, and the window's own, since a grant is the user's answer to
 * "may Instrument reach this" rather than something one chat asked alone.
 */
export async function ensureChat(chatId: TaskId): Promise<TaskId> {
  if (!isChatId(chatId)) {
    throw new Error(`Not a chat's id: ${chatId}`);
  }
  if (await getTaskSettings(taskDir(chatId))) {
    return chatId;
  }
  const made = await initializeTask(
    {
      initialSettings: { kind: "orchestrator", name: ORCHESTRATOR_TITLE },
      taskId: chatId,
      workspaceConfig: getWorkspaceConfig(),
    },
    {},
  );
  // Two sends racing for the same new chat: the other one made it.
  if (made.isErr() && !(await getTaskSettings(taskDir(chatId)))) {
    throw made.error;
  }
  await setTaskState(taskDir(chatId), {
    attachedFolders: await grantedFolders(),
  });
  return chatId;
}

/**
 * Every chat's record id, oldest first. A chat's id carries its session's
 * ULID, so the order the ids sort in is the order the chats were started.
 */
export function listChatIds(): TaskId[] {
  return chatDirs()
    .map((dir) => TaskIdSchema.parse(path.basename(dir)))
    .sort();
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

export { chatIdOf } from "../../schemas/chat-id";
