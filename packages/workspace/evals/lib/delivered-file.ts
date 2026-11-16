import fs from "node:fs";
import path from "node:path";

import {
  filesFolderPath,
  outputFolderPath,
} from "../../src/lib/chat/output-folder";
import { type ChatId } from "../../src/schemas/chat-id";

/**
 * Where `name` is, when a prompt asked for it in the workspace or the
 * Instrument folder: in a folder the agent named under Files, where its
 * shell's `$INSTRUMENT_FILES` points, at the top of Files, or at the top of
 * the Instrument folder, which the person's words name just as well. The
 * chat is named for the callers' sake; every run has a workspace of its own.
 */
export function deliveredFile(
  _chatId: ChatId,
  name: string,
): string | undefined {
  const files = filesFolderPath();
  const named = (() => {
    try {
      return fs
        .readdirSync(files, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(files, entry.name));
    } catch {
      return [];
    }
  })();
  return [...named, files, outputFolderPath()]
    .map((folder) => path.join(folder, name))
    .find((file) => fs.existsSync(file));
}
