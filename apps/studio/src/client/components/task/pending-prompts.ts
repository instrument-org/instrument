import {
  type SessionMessage,
  type SessionMessageDataPart,
  StoreId,
  type TranscriptMessage,
} from "@instrument-org/workspace/client";

type Shown = SessionMessage.WithParts | TranscriptMessage;

/**
 * Words the user sent that the workspace has not handed back yet: drawn as
 * their message from the press, since storing one and hearing it back through
 * the live list is a round trip the user should not watch.
 */
export interface PendingPrompt {
  message: SessionMessage.User & TranscriptMessage;
  /** The session's messages at the moment of sending, none of which can be this one's stored copy. */
  seen: ReadonlySet<StoreId.Message>;
}

export function pendingPrompt({
  change,
  messages,
  prompt,
  sessionId,
}: {
  /** The switch of model its turn will record, drawn with it from the press. */
  change?: SessionMessageDataPart.ModelChangeDataPart;
  messages: readonly Shown[];
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
        ...(change ? [switchPart(change, { createdAt, id, sessionId })] : []),
      ],
      role: "user",
    },
    seen: new Set(messages.map((message) => message.id)),
  };
}

function switchPart(
  data: SessionMessageDataPart.ModelChangeDataPart,
  {
    createdAt,
    id,
    sessionId,
  }: { createdAt: Date; id: StoreId.Message; sessionId: StoreId.Session },
) {
  return {
    data,
    metadata: { createdAt, id: StoreId.newPartId(), messageId: id, sessionId },
    type: "data-modelChange" as const,
  };
}

/**
 * The messages with the switch a send drew kept on its stored copy, until the
 * turn it starts records the switch there. Storing a message and starting its
 * turn are two writes, and the line would otherwise go and come back between
 * them. Anything after the message means the turn has had its say, so then
 * only what it recorded is drawn.
 */
export function withSentSwitch<T extends Shown>(
  messages: readonly T[],
  sent: PendingPrompt | undefined,
): readonly T[] {
  const last = messages.at(-1);
  const change = sent?.message.parts.find(
    (part) => part.type === "data-modelChange",
  );
  if (
    !sent ||
    !change ||
    last?.role !== "user" ||
    last.metadata.sessionId !== sent.message.metadata.sessionId ||
    sent.seen.has(last.id) ||
    textOf(last) !== textOf(sent.message) ||
    last.parts.some((part) => part.type === "data-modelChange")
  ) {
    return messages;
  }
  return [
    ...messages.slice(0, -1),
    // The same message with a part any message may have, which a spread of a
    // type parameter loses.
    { ...last, parts: [...last.parts, change] } as T,
  ];
}

const textOf = (message: Shown) =>
  message.parts.find((part) => part.type === "text")?.text;

/**
 * The pending prompts still waiting, in the order sent: each one gives way to
 * the first stored user message with its words that was not there when it was
 * sent, and no stored message stands in for two, so the same words sent twice
 * wait for two. `pending` itself while none has, so a render that settles
 * nothing hands on the same array.
 */
export function unsettledPrompts(
  pending: PendingPrompt[],
  messages: readonly Shown[],
): PendingPrompt[] {
  const claimed = new Set<StoreId.Message>();
  const waiting = pending.filter((entry) => {
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
  return waiting.length === pending.length ? pending : waiting;
}
