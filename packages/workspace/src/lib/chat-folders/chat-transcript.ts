import { APP_NAME_SLUG } from "@instrument-org/shared";

import { CHAT_FILE_NAME, CHATS_FOLDER_NAME } from "../../constants";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";

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
  // for a file written before the key was, which is every folder the update
  // made and any a person is holding from an older build.
  const named = CHAT_KEY.exec(head)?.[1] ?? CHAT_LINK.exec(head)?.[1];
  if (named === undefined) {
    return undefined;
  }
  const id = ChatIdSchema.safeParse(named);
  return id.success ? id.data : undefined;
}

/**
 * Whether a file is a chat's transcript the app writes, which it rewrites
 * from the chat's records after every reply: a `CHAT.md` in a folder of the
 * workspace's `Chats/` whose head names a chat. A file a person keeps under
 * that name anywhere else, or one naming no chat, is theirs.
 */
export function isChatTranscript(hostPath: string, text: string): boolean {
  const [file, , chats] = hostPath.split(/[/\\]/u).toReversed();
  return (
    file === CHAT_FILE_NAME &&
    chats === CHATS_FOLDER_NAME &&
    chatLinkedInText(text.slice(0, LINK_HEAD_BYTES)) !== undefined
  );
}
