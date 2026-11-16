import { APP_NAME_SLUG, chatIdNamedBy } from "@instrument-org/shared";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";

/**
 * Where earlier builds kept each chat's own folder, `Chats/<title>/` at the
 * workspace's top level, and the transcript they wrote there.
 */
export const CHATS_FOLDER_NAME = "Chats";
export const CHAT_FILE_NAME = "CHAT.md";

/** How much of a transcript's head is read to find the chat it links to. */
export const LINK_HEAD_BYTES = 2048;

/** The chat a `CHAT.md` names, in its front matter and then in its link. */
const CHAT_KEY = /^chat:\s*"?([^"\n]+?)"?\s*$/m;
const CHAT_LINK = new RegExp(`${APP_NAME_SLUG}://chat/([^)\\s]+)`);

/**
 * The chat the head of a transcript names: the front matter and the line
 * under it, however the rest of it reads. Nothing for text that is not one
 * of ours.
 */
export function chatLinkedInText(head: string): ChatId | undefined {
  // The key first, since that is where the chat is named; the link after it
  // for a file written before the key was.
  const key = CHAT_KEY.exec(head)?.[1];
  const named =
    (key === undefined ? undefined : chatIdNamedBy(key)) ??
    CHAT_LINK.exec(head)?.[1];
  if (named === undefined) {
    return undefined;
  }
  const id = ChatIdSchema.safeParse(named);
  return id.success ? id.data : undefined;
}
