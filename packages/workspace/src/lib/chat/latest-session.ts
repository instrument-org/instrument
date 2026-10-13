import { type SessionMessage } from "../../schemas/session/message";
import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { Store } from "../store";

/**
 * The words cut at a length for a note to the conversation, saying so where
 * they stop: the cut names itself, so a reader never mistakes the first part
 * of a long reply for the whole of a short one. For the conversation alone;
 * a prompt to any other model wants a plain cut, since the line is addressed
 * to the conversation and reads as an instruction anywhere else.
 */
export function cutForNote(text: string, maxLength: number): string {
  return text.length > maxLength
    ? `${text.slice(0, maxLength)}\n[cut here at ${maxLength.toLocaleString("en-US")} characters; the transcript has the rest]`
    : text;
}

/**
 * What an agent last wrote in a session, whole: in a task's, only what the
 * task wrote, never the chat's words it carries on from.
 */
export async function lastAssistantText({
  sessionId,
  chatId,
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
}): Promise<string | undefined> {
  const messages = await Store.getMessagesWithParts({
    inherited: false,
    sessionId,
    chatId,
  });
  if (messages.isErr()) {
    return undefined;
  }
  return lastAssistantTextIn(messages.value);
}

/** The same words, read from a transcript already in hand. */
export function lastAssistantTextIn(
  messages: SessionMessage.WithParts[],
): string | undefined {
  const last = messages.findLast((message) => message.role === "assistant");
  const text = last?.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
  return text || undefined;
}
