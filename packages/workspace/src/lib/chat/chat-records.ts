import fs from "node:fs/promises";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { ensureChatFolder } from "../chat-folders/chat-folder";
import { recordChatFolderName } from "../chat-folders/own-folder";
import { newChatName } from "../chat-folder-name";
import { getCurrentDate } from "../get-current-date";
import { initializeChat } from "../initialize-chat";
import {
  chatIds,
  chatOfSession,
  chatIdTaken,
  sessionOfChat,
} from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";

/**
 * A chat's record, made the first time something is sent in it, and named on
 * disk for the day it began, a few words of what was asked, and a short
 * random suffix.
 * It runs the conversation's agent, and holds only the folders sent in it
 * (what else it reaches is in folder-reach.ts). Asked again for the same
 * session, it answers with the chat it made.
 */
export async function ensureChat(
  sessionId: StoreId.Session,
  firstWords?: string,
): Promise<ChatId> {
  const existing = chatOfSession(sessionId);
  if (existing) {
    return existing;
  }
  const chatId = ChatIdSchema.parse(
    newChatName({
      date: getCurrentDate(),
      isTaken: chatIdTaken,
      title: firstWords,
    }),
  );
  // The folder the person sees, claimed before the chat exists rather than
  // at the end of the turn: the agent's finished work goes in it, and what
  // was pasted into the draft moves into it, both before the first command
  // runs. It is named for the first words until the title settles.
  const folder = await ensureChatFolder({
    folder: undefined,
    rootDir: getWorkspaceConfig().rootDir,
    title: firstWords,
  });
  const made = await initializeChat({
    chatId,
    opening: firstWords,
    sessionId,
  });
  if (made.isErr()) {
    // Two sends racing for the same new chat: the other one made it, and
    // the folder claimed here is nobody's, so it goes rather than sitting
    // empty under `Chats/`.
    await fs.rmdir(folder.path).catch(() => undefined);
    const raced = chatOfSession(sessionId);
    if (raced) {
      return raced;
    }
    throw made.error;
  }
  await recordChatFolderName(
    getWorkspaceConfig().workspaceMachineDir,
    chatId,
    folder.name,
  );
  return chatId;
}

/**
 * Every chat's record id, oldest first: by its session's id, a ULID, which
 * orders to the millisecond where the day in a folder's name does not.
 */
export function listChatIds(): ChatId[] {
  return chatIds().sort((a, b) =>
    (sessionOfChat(a) ?? "").localeCompare(sessionOfChat(b) ?? ""),
  );
}
