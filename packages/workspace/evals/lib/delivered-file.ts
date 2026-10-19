import fs from "node:fs";
import path from "node:path";

import {
  chatOutputFolder,
  outputFolderPath,
} from "../../src/lib/chat/output-folder";
import { type ChatId } from "../../src/schemas/chat-id";

/**
 * Where `name` is, when a prompt asked for it in the workspace or the
 * Instrument folder: the chat's own folder under `Chats/`, where its shell's
 * `$INSTRUMENT_OUTPUT` points, or the top of the Instrument folder, which the
 * person's words name just as well.
 */
export function deliveredFile(
  chatId: ChatId,
  name: string,
): string | undefined {
  return [chatOutputFolder(chatId), outputFolderPath()]
    .map((folder) => path.join(folder, name))
    .find((file) => fs.existsSync(file));
}
