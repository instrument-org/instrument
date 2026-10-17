import { APP_NAME_SLUG } from "@instrument-org/shared";
import fs from "node:fs/promises";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";

/** How much of a transcript is read to find the chat it links to. */
const LINK_HEAD_BYTES = 2048;

/** The chat a `CHAT.md` names, in its front matter and then in its link. */
const CHAT_KEY = /^chat:\s*"?([^"\n]+?)"?\s*$/m;
const CHAT_LINK = new RegExp(`${APP_NAME_SLUG}://chat/([^)\\s]+)`);

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
  // The key first, since that is where the chat is named; the link after it
  // for a file written before the key was, which is every folder the update
  // made and any a person is holding from an older build.
  const named = CHAT_KEY.exec(head)?.[1] ?? CHAT_LINK.exec(head)?.[1];
  if (named === undefined) {
    return undefined;
  }
  const id = ChatIdSchema.safeParse(named);
  return id.success ? id.data : undefined;
}
