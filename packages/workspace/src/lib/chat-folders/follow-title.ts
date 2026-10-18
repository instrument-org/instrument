import fs from "node:fs/promises";

import { type ChatId } from "../../schemas/chat-id";
import { readChatRecord, updateChatRecord } from "../chat-record";
import { chatDir } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { renameChatFolder } from "./chat-folder";
import { rewriteChatFolder } from "./on-turn-end";

/**
 * Renames a chat's folder to the title it now has, and records the name it
 * ended up under.
 *
 * Called when a title changes, rather than from the sweep: a sweep that
 * reconciled every folder against its title would rename the folder a
 * person had just renamed in a file manager, and would walk a numbered
 * folder up a number each time it ran. The two moments a title changes are
 * the only moments the folder should move.
 *
 * Best effort by design. Windows refuses a rename while anything holds the
 * folder, and a background job outlives the turn that started it, so this
 * can fail for reasons nobody did anything wrong about. A folder that keeps
 * its old name is still the chat's, found by the name its settings hold,
 * and the next title change tries again.
 */
export async function followTitle(
  chatId: ChatId,
  title: string,
): Promise<void> {
  try {
    const dir = chatDir(chatId);
    const record = await readChatRecord(dir);
    const from = record.settings?.folder;
    if (from === undefined || record.unreadable) {
      return;
    }
    const folder = await renameChatFolder({
      from,
      rootDir: getWorkspaceConfig().rootDir,
      title,
    });
    if (folder.name !== from) {
      await updateChatRecord(dir, (current) => ({
        ...current.raw,
        folder: folder.name,
      }));
    }
    // The transcript was written when the turn ended, which is before a
    // title settled from that turn landed; its front matter names the chat.
    // A folder the person took away is left for the chat's next change.
    if (await exists(folder.path)) {
      await rewriteChatFolder(chatId);
    }
  } catch (error) {
    getWorkspaceConfig().captureException(error);
  }
}

async function exists(entry: string): Promise<boolean> {
  try {
    await fs.stat(entry);
    return true;
  } catch {
    return false;
  }
}
