import fs from "node:fs/promises";

import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { getWorkspaceConfig } from "../workspace-config";
import { renameChatFolder } from "./chat-folder";
import {
  inChatFolderOrder,
  rewriteChatFolderInOrder,
} from "./write-chat-folder";
import { chatFolderNames, recordChatFolderName } from "./own-folder";

/**
 * Chats whose title changed while something of theirs was working in the
 * folder, which the chat's next settled turn moves to the title it has then.
 * Kept in memory alone: a folder a quit left behind is followed at the next
 * title change, as any rename that failed is.
 */
export const titlesToFollow = new Set<ChatId>();

/**
 * Renames a chat's folder to the title it now has, and records the name it
 * ended up under.
 *
 * Called when a title changes, rather than whenever the folder is written:
 * a write that reconciled the folder against its title would rename the
 * folder a person had just renamed in a file manager, and would walk a
 * numbered folder up a number each time it ran. The two moments a title
 * changes are the only moments the folder should move.
 *
 * Best effort by design. Windows refuses a rename while anything holds the
 * folder, and a background job outlives the turn that started it, so this
 * can fail for reasons nobody did anything wrong about. A folder that keeps
 * its old name is still the chat's, found by the name this computer
 * recorded, and the next title change tries again.
 */
export async function followTitle(
  chatId: ChatId,
  title: string,
): Promise<void> {
  try {
    // In the folder's order, from reading the recorded name to recording the
    // new one, so a write of the folder never sees the move half done.
    await inChatFolderOrder(chatId, async () => {
      const { rootDir, workspaceMachineDir } = getWorkspaceConfig();
      const from = chatFolderNames(workspaceMachineDir).get(chatId);
      if (from === undefined) {
        return;
      }
      const folder = await renameChatFolder({ from, rootDir, title });
      if (folder.name !== from) {
        await recordChatFolderName(workspaceMachineDir, chatId, folder.name);
        publisher.publish("chat.folderMoved", { id: chatId });
      }
      // The transcript was written when the turn ended, which is before a
      // title settled from that turn landed; its front matter names the
      // chat. A folder the person took away is left for the chat's next
      // change.
      if (await exists(folder.path)) {
        await rewriteChatFolderInOrder(chatId);
      }
    });
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
