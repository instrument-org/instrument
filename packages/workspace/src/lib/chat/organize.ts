import { type ChatId } from "../../schemas/chat-id";
import { type ChatChange } from "../chat-changes";
import { cappedTitle } from "../chat-folders/folder-name";
import { followTitle, titlesToFollow } from "../chat-folders/follow-title";
import { resolveChat } from "../record-folders";
import {
  archiveChat,
  chatById,
  chatIsWorking,
  chatRecordTitle,
  renameChat,
  setChatProject,
  setChatStarred,
  unarchiveChat,
} from "./chats";
import { closeChatTabs } from "./tab-cap";

/**
 * Moves a chat's folder to a title it was just given, unless something of
 * the chat's is running in it: a rename under a working agent takes its
 * working directory out from under it, and Windows refuses it outright. The
 * folder then catches up when the chat's turn settles (`retitle.ts`).
 */
export async function followTitleBetweenTurns(chatId: ChatId, title: string) {
  if (await chatIsWorking(chatId)) {
    titlesToFollow.add(chatId);
    return;
  }
  titlesToFollow.delete(chatId);
  await followTitle(chatId, title);
}

/** Names a chat as typed, and its folder with it once nothing works there. */
export async function renameChatAndFolder(
  chatId: ChatId,
  title: string,
): Promise<boolean> {
  const renamed = await renameChat(chatId, title);
  if (renamed) {
    await followTitleBetweenTurns(chatId, cappedTitle(title));
  }
  return renamed;
}

/**
 * Puts a chat away. Nothing of an archived chat works on, so its agents'
 * tabs go, but for the ones the person used.
 */
export async function archiveChatAndTabs(chatId: ChatId): Promise<boolean> {
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
      return renameChatAndFolder(chatId, change.before);
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
    case "project": {
      if (((await chatById(chatId))?.project ?? null) !== change.after) {
        return false;
      }
      return setChatProject(chatId, change.before);
    }
  }
}
