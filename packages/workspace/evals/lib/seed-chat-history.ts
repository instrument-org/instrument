/**
 * A long chat's earlier turns, written before a case's prompt the way the app
 * wrote them: each user message built by `newMessage`, which attaches what
 * the real composer's send does (memory, the view, the browser's tabs, the
 * project), each reply stored beside it, and a price-step rollover every few
 * turns, marked and drawn as `prepareModelMessages` draws one. For a case
 * about what a long chat carries into each fresh window, which a chat that
 * starts with the case's prompt never has.
 */
import { type AIGatewayModelURI } from "@instrument-org/ai-gateway";

import { ChatReads } from "../../src/lib/chat-reads";
import { ChatWrites } from "../../src/lib/chat-writes";
import { newMessage } from "../../src/lib/new-message";
import { type ChatId } from "../../src/schemas/chat-id";
import { type SessionMessage } from "../../src/schemas/session/message";
import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { StoreId } from "../../src/schemas/store-id";

export interface SeededTurn {
  /** What the person typed. */
  ask: string;
  /** The reply the chat gave. */
  reply: string;
  /** What the window showed as the message was sent. */
  viewing?: SessionMessageDataPart.ViewContextDataPart;
}

/** Spacing between seeded messages, so their ids and times keep their order. */
const MESSAGE_SPACING_MS = 10;

export async function seedChatHistory({
  chatId,
  modelURI,
  rolloverEvery,
  sessionId,
  summary,
  turns,
}: {
  chatId: ChatId;
  modelURI: AIGatewayModelURI.Type;
  /** A rollover after every this many turns; none when absent. */
  rolloverEvery?: number;
  sessionId: StoreId.Session;
  /** The summary each rollover is drawn with, by the turn it follows. */
  summary: (turn: number) => string;
  turns: readonly SeededTurn[];
}): Promise<void> {
  for (const [index, turn] of turns.entries()) {
    const sent = await newMessage({
      chatId,
      modelURI,
      prompt: turn.ask,
      sessionId,
      ...(turn.viewing ? { viewing: turn.viewing } : {}),
    });
    if (sent.isErr()) {
      throw sent.error;
    }
    (await ChatWrites.saveMessageWithParts(sent.value, chatId))._unsafeUnwrap();
    await pause();

    const replyId = StoreId.newMessageId();
    const createdAt = new Date();
    const reply: SessionMessage.WithParts = {
      id: replyId,
      metadata: {
        createdAt,
        finishReason: "stop",
        finishedAt: createdAt,
        modelId: "seeded",
        providerId: "seeded",
        sessionId,
      },
      parts: [
        {
          metadata: {
            createdAt,
            id: StoreId.newPartId(),
            messageId: replyId,
            sessionId,
          },
          text: turn.reply,
          type: "text",
        },
      ],
      role: "assistant",
    };
    (await ChatWrites.saveMessageWithParts(reply, chatId))._unsafeUnwrap();
    await pause();

    if (rolloverEvery !== undefined && (index + 1) % rolloverEvery === 0) {
      await drawRollover({
        boundary: replyId,
        chatId,
        sessionId,
        summary: summary(index + 1),
      });
    }
  }
}

/**
 * A summarized rollover at `boundary`, as `recordRollover` records one: the
 * mark with its summary on the newest message, then the boundary on the
 * session.
 */
async function drawRollover({
  boundary,
  chatId,
  sessionId,
  summary,
}: {
  boundary: StoreId.Message;
  chatId: ChatId;
  sessionId: StoreId.Session;
  summary: string;
}) {
  const history = (
    await ChatReads.history({ chatId, sessionId })
  )._unsafeUnwrap();
  const users = history.filter((message) => message.role === "user").length;
  (
    await ChatWrites.savePart(
      {
        data: {
          droppedMessages: history.length - users,
          retainedUserMessages: users,
          summary,
        },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId: boundary,
          sessionId,
        },
        type: "data-contextRollover",
      },
      chatId,
    )
  )._unsafeUnwrap();
  const session = (
    await ChatReads.session({ chatId, sessionId })
  )._unsafeUnwrap();
  (
    await ChatWrites.saveSession(
      { ...session, rolledOverAfterMessageId: boundary },
      chatId,
    )
  )._unsafeUnwrap();
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, MESSAGE_SPACING_MS));
}
