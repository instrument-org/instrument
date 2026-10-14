import fs from "node:fs/promises";
import path from "node:path";

import { disposeSessionsStoreStorage } from "../../lib/session-store-storage";
import { ChatIdSchema } from "../../schemas/chat-id";

/**
 * Removes a test's temp folder, first closing every chat database in it the
 * test opened. Windows refuses to delete a file a process holds open, where
 * macOS and Linux unlink it from under the open handle; a chat's folder is
 * named by its id, so each `chat.db` names the store to close. The retries
 * give a subprocess the test killed time to exit and let go of its folder,
 * which it does after the kill returns on Windows.
 */
export async function removeChatsDir(dir: string): Promise<void> {
  const entries = await fs
    .readdir(dir, { recursive: true })
    .catch((): string[] => []);
  for (const entry of entries) {
    if (path.basename(entry) !== "chat.db") {
      continue;
    }
    const id = ChatIdSchema.safeParse(
      path.basename(path.dirname(path.join(dir, entry))),
    );
    if (id.success) {
      await disposeSessionsStoreStorage(id.data);
    }
  }
  await fs.rm(dir, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 100,
  });
}
