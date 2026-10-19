import fs from "node:fs";
import path from "node:path";

import { chatFolderName } from "../../lib/chat-folder-name";
import {
  chatOfSession,
  forgetChatFolders,
  chatIdTaken,
} from "../../lib/record-folders";
import { writingChatRecords } from "../../lib/records/chat-records";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";

/**
 * The chat a session is, made in the current chats folder the first time it
 * is asked for: a folder under `chats/` whose settings name the session, and
 * the session's own log started in it, which is what a chat the app made has.
 * For tests that need a chat to exist without the grants and the rest that
 * `ensureChat` brings.
 */
export async function chatFor(
  sessionId: StoreId.Session = StoreId.newSessionId(),
  /** The chat's folder name, where a test wants one of its own. */
  named?: ChatId,
  /** When its session began, for a test that dates what it writes. */
  { createdAt = new Date() }: { createdAt?: Date } = {},
): Promise<ChatId> {
  const existing = chatOfSession(sessionId);
  if (existing) {
    return existing;
  }
  const id =
    named ??
    ChatIdSchema.parse(
      chatFolderName({
        date: new Date(2026, 8, 26),
        isTaken: chatIdTaken,
        title: `chat ${sessionId.slice(-6).toLowerCase()}`,
      }),
    );
  const recordDir = path.join(getWorkspaceConfig().chatsDir, id);
  fs.mkdirSync(recordDir, { recursive: true });
  fs.writeFileSync(
    path.join(recordDir, "settings.json"),
    JSON.stringify({
      chatSessionId: sessionId,
      name: "Instrument",
    }),
  );
  forgetChatFolders();
  // Its own session's log, which every write into the chat is appended to.
  await writingChatRecords()?.startSession(id, { createdAt, id: sessionId });
  return id;
}
