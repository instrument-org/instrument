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

/**
 * A transcript's front matter, then the first line under it: where the app
 * wrote the chat's key and its link, and the only place either is read.
 */
const TRANSCRIPT_HEAD =
  /^\uFEFF?---\r?\n(?<front>[\s\S]*?)\r?\n---\r?\n\s*(?<line>[^\n]*)/;
const CHAT_KEY = /^chat:\s*"?([^"\n]+?)"?\s*$/m;
const CHAT_LINK = new RegExp(`${APP_NAME_SLUG}://chat/([^)\\s]+)`);

/**
 * The chat the head of a transcript names: the front matter and the line
 * under it, however the rest of it reads. Nothing for text that is not one
 * of ours.
 */
export function chatLinkedInText(head: string): ChatId | undefined {
  const parts = TRANSCRIPT_HEAD.exec(head)?.groups;
  if (parts?.front === undefined || parts.line === undefined) {
    return undefined;
  }
  // The key first, since that is where the chat is named; the link after it
  // for a file written before the key was.
  const key = CHAT_KEY.exec(parts.front)?.[1];
  const named =
    (key === undefined ? undefined : chatIdNamedBy(key)) ??
    CHAT_LINK.exec(parts.line)?.[1];
  if (named === undefined) {
    return undefined;
  }
  const id = ChatIdSchema.safeParse(named);
  return id.success ? id.data : undefined;
}
