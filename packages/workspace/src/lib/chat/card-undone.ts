import { z } from "zod";

import { ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { ChatWrites } from "../chat-writes";

/** A changes card's part, by where it is in its chat. */
export const ChangesCardSchema = z.object({
  chatId: ChatIdSchema,
  messageId: StoreId.MessageSchema,
  partId: StoreId.PartSchema,
  sessionId: StoreId.SessionSchema,
});

export type ChangesCard = z.output<typeof ChangesCardSchema>;

/**
 * Writes onto a projects or chats changes card that its Undo put something
 * back, once: every device then shows it undone, and the next message the
 * person sends tells the agent (`undone-changes-model-text.ts`).
 */
export async function markCardUndone(
  card: ChangesCard,
  { skipped, undone }: { skipped: number; undone: number },
): Promise<void> {
  if (undone === 0) {
    return;
  }
  const mark = { at: new Date().toISOString(), skipped };
  const written = await ChatWrites.updatePart(
    card,
    (part): SessionMessagePart.Type => {
      if (part.type === "data-setupChanges" && !part.data.undone) {
        return { ...part, data: { ...part.data, undone: mark } };
      }
      if (part.type === "data-chatChanges" && !part.data.undone) {
        return { ...part, data: { ...part.data, undone: mark } };
      }
      return part;
    },
  );
  if (written.isErr()) {
    throw written.error;
  }
}
