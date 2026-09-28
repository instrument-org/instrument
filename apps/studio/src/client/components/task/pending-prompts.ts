import { type SessionMessage, StoreId } from "@instrument-org/workspace/client";

/**
 * Words the user sent that the workspace has not handed back yet: drawn as
 * their message from the press, since storing one and hearing it back through
 * the live list is a round trip the user should not watch.
 */
export interface PendingPrompt {
  message: SessionMessage.UserWithParts;
  /** The session's messages at the moment of sending, none of which can be this one's stored copy. */
  seen: ReadonlySet<StoreId.Message>;
}

export function pendingPrompt({
  messages,
  prompt,
  sessionId,
}: {
  messages: SessionMessage.WithParts[];
  prompt: string;
  sessionId: StoreId.Session;
}): PendingPrompt | undefined {
  // Stored trimmed, and a message with no words is not stored as a text part.
  const text = prompt.trim();
  if (!text) {
    return;
  }
  const createdAt = new Date();
  const id = StoreId.newMessageId();
  return {
    message: {
      id,
      metadata: { createdAt, sessionId },
      parts: [
        {
          metadata: {
            createdAt,
            id: StoreId.newPartId(),
            messageId: id,
            sessionId,
          },
          text,
          type: "text",
        },
      ],
      role: "user",
    },
    seen: new Set(messages.map((message) => message.id)),
  };
}

const textOf = (message: SessionMessage.WithParts) =>
  message.parts.find((part) => part.type === "text")?.text;

/**
 * The pending prompts still waiting, in the order sent: each one gives way to
 * the first stored user message with its words that was not there when it was
 * sent, and no stored message stands in for two, so the same words sent twice
 * wait for two.
 */
export function unsettledPrompts(
  pending: PendingPrompt[],
  messages: SessionMessage.WithParts[],
): PendingPrompt[] {
  const claimed = new Set<StoreId.Message>();
  return pending.filter((entry) => {
    const text = textOf(entry.message);
    const stored = messages.find(
      (message) =>
        message.role === "user" &&
        message.metadata.sessionId === entry.message.metadata.sessionId &&
        !entry.seen.has(message.id) &&
        !claimed.has(message.id) &&
        textOf(message) === text,
    );
    if (stored) {
      claimed.add(stored.id);
      return false;
    }
    return true;
  });
}
