import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { chatFolderName } from "../generate-task-folder-name";
import { getCurrentDate } from "../get-current-date";
import { initializeChat } from "../initialize-task";
import {
  chatIds,
  chatOfSession,
  chatIdTaken,
  sessionOfChat,
} from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";

/**
 * The name on a chat's record. A chat's title is its session's; this is
 * what the record answers with where a task's name would be read.
 */
const CHAT_RECORD_NAME = "Instrument";

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
): Promise<ChatId> {
  const existing = chatOfSession(sessionId);
  if (existing) {
    return existing;
  }
  const chatId = ChatIdSchema.parse(
    chatFolderName({
      date: getCurrentDate(),
      isTaken: chatIdTaken,
      title: firstWords,
    }),
  );
  const made = await initializeChat({
    chatId,
    initialSettings: { name: CHAT_RECORD_NAME },
    sessionId,
    workspaceConfig: getWorkspaceConfig(),
  });
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
export function listChatIds(): ChatId[] {
  return chatIds().sort((a, b) =>
    (sessionOfChat(a) ?? "").localeCompare(sessionOfChat(b) ?? ""),
  );
}
