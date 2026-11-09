import { EventEmitter, on } from "node:events";
import fs from "node:fs/promises";

import { CHAT_FILE_NAME } from "../../constants";
import { type ChatId } from "../../schemas/chat-id";
import { chatFolderTheyOpen } from "../chat/output-folder";
import { chatDir, chatOwnFolder, resolveChat } from "../record-folders";
import { isSystemClutter } from "../system-clutter";

/**
 * The chat's own folder under `Chats/` when it is one the person opens, which
 * means inside their Instrument folder (`chatFolderTheyOpen`). A workspace
 * kept in the app's own data has none: its chats' work goes to the
 * Instrument folder itself, which is no one chat's.
 */
function folderTheyOpen(id: ChatId): string | undefined {
  return resolveChat(id) === undefined
    ? undefined
    : chatFolderTheyOpen(chatOwnFolder(chatDir(id)));
}

/**
 * Whether a chat's folder has anything at its top level besides the
 * `CHAT.md` the app writes there and what file managers and programs leave
 * (`isSystemClutter`, dot names included): a file the agent saved, one the
 * person sent, or one they put there themselves. One read of the folder's
 * names, no stat; a folder not made yet has nothing in it.
 */
export async function hasFilesBesideChatFile(folder: string): Promise<boolean> {
  let names: string[];
  try {
    names = await fs.readdir(folder);
  } catch {
    return false;
  }
  return names.some(
    (name) => name !== CHAT_FILE_NAME && !isSystemClutter(name),
  );
}

/** The chat's own folder while it has files in it (`hasFilesBesideChatFile`), and null otherwise. */
export async function chatFolderWithFiles(id: ChatId): Promise<null | string> {
  const folder = folderTheyOpen(id);
  return folder !== undefined && (await hasFilesBesideChatFile(folder))
    ? folder
    : null;
}

/**
 * One firing per change the system reports at the top of the chat's folder,
 * so a file the person adds or removes in a file manager is heard without
 * waiting for the chat's next message. Watches the one folder, not what is
 * under it. The folder is looked for again on each of `retarget` (the chat's
 * records moving, its folder renamed): the first turn makes it, and a rename
 * moves it. Ends when `requestSignal` aborts, or when the reader stops reading.
 */
export async function* chatFolderEdits(
  id: ChatId,
  retarget: AsyncIterable<unknown>[],
  requestSignal: AbortSignal | undefined,
): AsyncGenerator<null> {
  const ended = new AbortController();
  const signal = requestSignal
    ? AbortSignal.any([requestSignal, ended.signal])
    : ended.signal;
  const edits = new EventEmitter();
  let watched: { folder: string; stop: AbortController } | undefined;
  const watch = () => {
    const folder = folderTheyOpen(id);
    if (watched?.folder === folder || signal.aborted) {
      return;
    }
    watched?.stop.abort();
    watched = undefined;
    if (folder === undefined) {
      return;
    }
    const entry = { folder, stop: new AbortController() };
    watched = entry;
    void (async () => {
      try {
        for await (const _event of fs.watch(folder, {
          signal: AbortSignal.any([signal, entry.stop.signal]),
        })) {
          edits.emit("edit");
        }
      } catch {
        // Not made yet, gone, or stopped: the next retarget looks again.
      }
      if (watched === entry) {
        watched = undefined;
      }
    })();
  };
  watch();
  for (const source of retarget) {
    void (async () => {
      try {
        for await (const _change of source) {
          watch();
        }
      } catch {
        // Ends with the request.
      }
    })();
  }
  try {
    for await (const _edit of on(edits, "edit", { signal })) {
      yield null;
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  } finally {
    ended.abort();
  }
}
