import { type ChatId } from "../../schemas/chat-id";
import { type ChatChange } from "../chat-changes";
import { resolveChat } from "../record-folders";
import {
  archiveChat,
  chatById,
  chatRecordTitle,
  markChatRead,
  markChatUnread,
  renameChat,
  setChatProject,
  setChatStarred,
  unarchiveChat,
} from "./chats";
import { getWorkspaceActorRef } from "../workspace-actor-ref";
import { getWorkspaceConfig } from "../workspace-config";
import { isWorking } from "./activity";
import { openAsks } from "./open-asks";
import { stopChat } from "./stop-chat";
import { closeChatTabs } from "./tab-cap";

/**
 * Puts a chat away, as the person's Archive does, whoever asks. Archiving a
 * chat is being done with it, so whatever of it is at work or waiting on the
 * person stops as Stop stops it, and its agents' tabs go, but for the ones
 * the person used.
 */
export async function archiveChatAndTabs(chatId: ChatId): Promise<boolean> {
  if (isWorking(chatId) || (await openAsks(chatId)).length > 0) {
    await stopChat(chatId, {
      captureException: getWorkspaceConfig().captureException,
      workspaceRef: getWorkspaceActorRef(),
    });
  }
  const archived = await archiveChat(chatId);
  void closeChatTabs(chatId, { trashed: false }).catch(() => undefined);
  return archived;
}

/**
 * Sets each change's field back to what it held before, skipping a field
 * that no longer holds what the change set: the person, or another device,
 * has changed it since, and theirs stands. Answers how many went back.
 */
export async function undoChatChanges(
  changes: readonly ChatChange[],
): Promise<{ skipped: number; undone: number }> {
  let undone = 0;
  for (const change of changes) {
    if (await undoChatChange(change)) {
      undone += 1;
    }
  }
  return { skipped: changes.length - undone, undone };
}

async function undoChatChange(change: ChatChange): Promise<boolean> {
  const chatId = resolveChat(change.chat);
  if (!chatId) {
    return false;
  }
  switch (change.field) {
    case "title": {
      if ((await chatRecordTitle(chatId)) !== change.after) {
        return false;
      }
      // Settled, as every title typed is: the records rank a settled title
      // over one the app may still change, so the title from before cannot
      // go back to being the app's to replace.
      return renameChat(chatId, change.before);
    }
    case "archived": {
      if ((await chatById(chatId))?.archived !== change.after) {
        return false;
      }
      return change.before ? archiveChatAndTabs(chatId) : unarchiveChat(chatId);
    }
    case "starred": {
      if ((await chatById(chatId))?.starred !== change.after) {
        return false;
      }
      return setChatStarred(chatId, change.before);
    }
    case "unread": {
      if ((await chatById(chatId))?.unread !== change.after) {
        return false;
      }
      // The person's own press puts the mark back, so it holds as one they
      // set does.
      return change.before
        ? markChatUnread(chatId, { byUser: true })
        : markChatRead(chatId);
    }
    case "project": {
      if (((await chatById(chatId))?.project ?? null) !== change.after) {
        return false;
      }
      return setChatProject(chatId, change.before);
    }
  }
}
