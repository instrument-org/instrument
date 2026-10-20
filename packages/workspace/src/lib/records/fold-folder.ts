import fs from "node:fs/promises";
import path from "node:path";

import { parseRecordFileName } from "./file-names";
import { type FoldedChat, foldChat } from "./fold";

/**
 * A chat folded from the files in its record folder, read straight off disk
 * rather than through the records service: for a caller that runs before the
 * workspace is up, or over a copy of one nothing has open. A launch's
 * migrations are both, and so is a script or a test over the clone of a real
 * install.
 */
export async function foldChatInFolder(dir: string): Promise<FoldedChat> {
  const names = (await fs.readdir(dir))
    .filter((name) => parseRecordFileName(name) !== undefined)
    .toSorted();
  const files = await Promise.all(
    names.map(async (name) => ({
      bytes: await fs.readFile(path.join(dir, name)),
      name,
    })),
  );
  return foldChat(files);
}
