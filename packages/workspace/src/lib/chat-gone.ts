import { type ChatId } from "../schemas/chat-id";
import { recordRemoved } from "./record-changes";
import { forgetChat, sessionOfChat } from "./record-folders";
import { writingChatRecords } from "./records/chat-records";

/**
 * What a chat's records folder going takes, once it has: the index forgets
 * the chat, so a write to it is refused rather than making its folder again,
 * its records let go, and whatever lists it hears it is gone. Called by the
 * trash here and by a look that finds the folder gone (a trash on another
 * device arriving by sync, a delete in a file manager), which also sees the
 * trash here, so a chat the index has already forgotten is left alone and
 * each is said gone once.
 */
export async function chatGone(id: ChatId): Promise<void> {
  if (sessionOfChat(id) === undefined) {
    return;
  }
  forgetChat(id);
  // What it had yet to land has no folder to land in.
  await writingChatRecords()
    ?.close(id)
    .catch(() => undefined);
  recordRemoved(id);
}
