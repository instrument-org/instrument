import fs from "node:fs/promises";

import { type ChatDir } from "../schemas/paths";
import { getCurrentDate } from "./get-current-date";

/**
 * The chat folder's own timestamps, for a chat with nothing recorded.
 *
 * The folder and not the database inside it: opening a chat checkpoints that
 * database, so its mtime says a chat was worked on when it was only read.
 *
 * See docs/findings/task-list-order-followed-file-mtimes.md.
 */
export async function getChatDirTimestamps(dir: ChatDir) {
  try {
    return await fs.stat(dir).then((stats) => ({
      createdAt: stats.birthtime,
      updatedAt: stats.mtime,
    }));
  } catch {
    // The folder was listed moments ago. Gone now means deleted mid-scan, so
    // answer rather than fail the whole list.
    const now = getCurrentDate();
    return { createdAt: now, updatedAt: now };
  }
}
