import fs from "node:fs/promises";

import { type ChatId } from "../../schemas/chat-id";
import { chatLinkedInText, LINK_HEAD_BYTES } from "./chat-transcript";

/**
 * The chat a transcript names, from the head of the file: the front matter
 * and the line under it, however the rest of it reads. Nothing for a file
 * that is not one of ours, which is what makes this the test of whether a
 * file in a chat's folder is a transcript the app wrote.
 */
export async function chatLinkedInFile(
  file: string,
): Promise<ChatId | undefined> {
  let head: string;
  try {
    const handle = await fs.open(file, "r");
    try {
      const read = await handle.read({
        buffer: Buffer.alloc(LINK_HEAD_BYTES),
        position: 0,
      });
      head = read.buffer.toString("utf8", 0, read.bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  return chatLinkedInText(head);
}
