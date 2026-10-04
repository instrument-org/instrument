import fs from "node:fs";
import path from "node:path";

import { chatFolderName } from "../../lib/generate-task-folder-name";
import {
  chatOfSession,
  forgetRecordFolders,
  recordIdTaken,
} from "../../lib/record-folders";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";

/**
 * The chat a session is, made under the current workspace root the first time
 * it is asked for: a folder under `chats/` whose settings name the session,
 * which is all the index needs to find it. For tests that need a chat to exist
 * without the grants and the rest that `ensureChat` brings.
 */
export function chatFor(
  sessionId: StoreId.Session = StoreId.newSessionId(),
  /** The chat's folder name, where a test wants one of its own. */
  named?: ChatId,
): ChatId {
  const existing = chatOfSession(sessionId);
  if (existing) {
    return existing;
  }
  const id =
    named ??
    ChatIdSchema.parse(
      chatFolderName({
        date: new Date(2026, 8, 26),
        isTaken: recordIdTaken,
        title: `chat ${sessionId.slice(-6).toLowerCase()}`,
      }),
    );
  const privateDir = path.join(
    getWorkspaceConfig().rootDir,
    "chats",
    id,
    ".instrument",
  );
  fs.mkdirSync(privateDir, { recursive: true });
  fs.writeFileSync(
    path.join(privateDir, "settings.json"),
    JSON.stringify({
      chatSessionId: sessionId,
      name: "Instrument",
    }),
  );
  forgetRecordFolders();
  return id;
}
