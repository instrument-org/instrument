import { createContextMessage } from "../../agents/shared";
import { currentEnvironment } from "../../lib/environment";
import { ChatWrites } from "../../lib/chat-writes";
import { SESSION_CONTEXT_VERSION } from "../../lib/session-baseline";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";

/**
 * A session's history written the way a turn writes it, for tests of what a
 * session was last told (`lib/last-told.ts`): a baseline recording what it
 * told, and messages carrying the notes told since.
 */

/** Writes a baseline for the session that told it `told`. */
export async function writeBaseline(
  chatId: ChatId,
  sessionId: StoreId.Session,
  told: Parameters<typeof createContextMessage>[0]["told"] = {},
): Promise<void> {
  const message = createContextMessage({
    agentName: "instrument",
    environment: currentEnvironment(chatId),
    now: new Date(),
    sessionId,
    textParts: ["The baseline."],
    told,
  });
  (
    await ChatWrites.saveMessageWithParts(
      {
        ...message,
        metadata: {
          ...message.metadata,
          contextVersion: SESSION_CONTEXT_VERSION,
        },
      },
      chatId,
    )
  )._unsafeUnwrap();
}

/**
 * Writes a message of `role` carrying the given parts, each a part a note
 * builder returned or the data of one, and answers its id.
 */
export async function writeMessage(
  chatId: ChatId,
  sessionId: StoreId.Session,
  role: "assistant" | "user",
  parts: (
    | Omit<SessionMessagePart.DataPart, "metadata">
    | SessionMessagePart.Type
    | undefined
  )[],
): Promise<StoreId.Message> {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  const written = parts.flatMap((part) =>
    part === undefined
      ? []
      : [
          // Spreading a union loses which member it was; only the
          // metadata changed.
          {
            ...part,
            metadata: {
              createdAt,
              id: StoreId.newPartId(),
              messageId: id,
              sessionId,
            },
          } as SessionMessagePart.Type,
        ],
  );
  const message: SessionMessage.WithParts =
    role === "user"
      ? { id, metadata: { createdAt, sessionId }, parts: written, role }
      : {
          id,
          metadata: {
            createdAt,
            finishReason: "stop",
            modelId: "test-model",
            providerId: "test",
            sessionId,
          },
          parts: written,
          role,
        };
  const saved = await ChatWrites.saveMessageWithParts(message, chatId);
  if (saved.isErr()) {
    throw saved.error;
  }
  return id;
}
