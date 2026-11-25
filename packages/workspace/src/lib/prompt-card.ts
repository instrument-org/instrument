import { z } from "zod";

import { ChatIdSchema } from "../schemas/chat-id";
import {
  MESSAGE_FENCE,
  type MessageDraft,
  parseMessage,
} from "./parse-message";

/**
 * A prompt card's Send, once pressed: the chat it started and when. Kept on
 * the reply's text part, under {@link PROMPTS_SENT_KEY} in its metadata, one
 * entry per card by the card's place among the part's message fences, so
 * every device shows the card sent and none sends it again. A build that does
 * not know the key keeps it as it was written.
 */
const PromptSentSchema = z.object({
  at: z.iso.datetime({ offset: true }),
  chat: ChatIdSchema,
  fence: z.number().int().nonnegative(),
});

export type PromptSent = z.output<typeof PromptSentSchema>;

export const PROMPTS_SENT_KEY = "promptsSent";

/**
 * Whether a message is a prompt Send can start a chat with: one for a new
 * chat here, rather than one addressed to another app's agent (`to:`), which
 * is only copied.
 */
export function isSendablePrompt(message: MessageDraft): boolean {
  return (
    message.kind === "prompt" &&
    message.to === undefined &&
    message.sender !== "agent"
  );
}

/**
 * Where a sendable prompt with these words is among a reply's message
 * fences, counting every message fence, or nothing when the reply has none.
 * Two cards with the same words are the first of them.
 */
export function promptFenceOf(text: string, body: string): number | undefined {
  let index = 0;
  for (const match of text.matchAll(MESSAGE_FENCE)) {
    const message = parseMessage(match.groups?.body ?? "");
    if (isSendablePrompt(message) && message.body === body) {
      return index;
    }
    index += 1;
  }
  return undefined;
}

/** Every Send pressed on a reply's prompt cards, as its part's metadata keeps them. */
export function promptsSentOf(metadata: Record<string, unknown>): PromptSent[] {
  const parsed = z
    .array(PromptSentSchema)
    .safeParse(metadata[PROMPTS_SENT_KEY]);
  return parsed.success ? parsed.data : [];
}

/** What the card at `fence` was sent as, or nothing while it has not been. */
export function promptSentAt(
  metadata: Record<string, unknown>,
  fence: number,
): PromptSent | undefined {
  return promptsSentOf(metadata).find((sent) => sent.fence === fence);
}
