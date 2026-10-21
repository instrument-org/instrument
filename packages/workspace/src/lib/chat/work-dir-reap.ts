import { readdirSync, rmdirSync, unlinkSync } from "node:fs";
import path from "node:path";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publishedUntil } from "../../rpc/publisher";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { listChatBackgroundProcesses } from "../background-processes";
import { resolveChat } from "../record-folders";
import { workDir } from "../work-dir";
import { getWorkspaceConfig } from "../workspace-config";

/**
 * What the system leaves in a folder it has shown, which leaves the folder
 * no less empty: the Finder's view settings.
 */
const SYSTEM_LITTER = new Set([".DS_Store"]);

/**
 * Removes a chat's work folder whenever one of its sessions finishes a turn
 * and leaves the chat at rest with nothing in its folder, so a chat whose
 * agent ran a command and kept nothing leaves no folder behind. The next
 * command makes it again.
 *
 * At rest is the moment because nothing of the chat's can be using the
 * folder then: no session of it, its tasks' included, is running a command,
 * and nothing it left running in the background is still going. Folders a
 * turn left behind when the app quit or crashed before it ended are reaped
 * when the workspace starts.
 */
export function startWorkDirReap(
  workspaceRef: WorkspaceActorRef,
  signal?: AbortSignal,
): void {
  try {
    reapWorkDirs(workspaceRef);
  } catch (error) {
    getWorkspaceConfig().captureException(error);
  }
  void (async () => {
    for await (const { id } of publishedUntil("session.done", signal)) {
      try {
        reapWorkDir(id, workspaceRef);
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}

/**
 * Removes every chat's work folder that `reapWorkDir` would: each one
 * empty, of a chat that is still there, with nothing of the chat's at work.
 */
export function reapWorkDirs(workspaceRef: WorkspaceActorRef): void {
  let names: string[];
  try {
    names = readdirSync(getWorkspaceConfig().workFoldersDir);
  } catch {
    return;
  }
  for (const name of names) {
    const chatId = ChatIdSchema.safeParse(name);
    if (chatId.success) {
      reapWorkDir(chatId.data, workspaceRef);
    }
  }
}

/**
 * Removes the chat's work folder if it is empty and nothing of the chat's is
 * at work: no session of it, its tasks' included, is running, no command it
 * left running in the background is still going, and it is not being
 * trashed, which takes the folder itself. Whether it removed it.
 *
 * Synchronous from the check to the removal, so no session can start in
 * between: a new session's first command makes the folder only after this
 * has run.
 */
export function reapWorkDir(
  chatId: ChatId,
  workspaceRef: WorkspaceActorRef,
): boolean {
  if (resolveChat(chatId) === undefined) {
    return false;
  }
  const { context } = workspaceRef.getSnapshot();
  if (context.chatsBeingTrashed.includes(chatId)) {
    return false;
  }
  const running = (context.sessionRefsByChatId.get(chatId) ?? []).some(
    (ref) => ref.getSnapshot().status === "active",
  );
  if (running) {
    return false;
  }
  if (
    listChatBackgroundProcesses(chatId).some((job) => job.status === "running")
  ) {
    return false;
  }
  return removeIfEmpty(workDir(chatId));
}

/**
 * Removes a folder holding nothing, or nothing but what the system leaves
 * in a folder it has shown, the way `rmdir` does: a folder that holds
 * anything else, or gains it on the way, stays. Whether it removed it.
 */
function removeIfEmpty(dir: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  if (!entries.every((entry) => SYSTEM_LITTER.has(entry))) {
    return false;
  }
  try {
    for (const entry of entries) {
      unlinkSync(path.join(dir, entry));
    }
    rmdirSync(dir);
    return true;
  } catch {
    return false;
  }
}
