import { type SubdomainPart } from "../schemas/subdomain-part";
import { type ChatId, ChatIdSchema } from "../schemas/chat-id";
import { chatFolderName } from "./chat-folder-name";
import { getCurrentDate } from "./get-current-date";
import { chatIdTaken } from "./record-folders";

/**
 * A free id for a new chat: `preferredFolderName` where no chat holds it,
 * otherwise one named for the day and the words of `prompt`.
 */
export function newChatId({
  preferredFolderName,
  prompt,
}: {
  preferredFolderName?: SubdomainPart;
  prompt?: string;
}): ChatId {
  if (preferredFolderName && !chatIdTaken(preferredFolderName)) {
    return ChatIdSchema.parse(preferredFolderName);
  }
  return ChatIdSchema.parse(
    chatFolderName({
      date: getCurrentDate(),
      isTaken: chatIdTaken,
      title: prompt,
    }),
  );
}
