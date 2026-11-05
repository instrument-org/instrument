import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import { err, ok, type Result } from "neverthrow";
import ms from "ms";
import path from "node:path";

import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { getCurrentDate } from "../get-current-date";
import { isToolPart } from "../is-tool-part";
import { readJsonRecord, updateJsonRecord } from "../json-record-file";
import { getWorkspaceConfig } from "../workspace-config";
import { openAsksUntil } from "./open-asks";

/** The messages the person has to have written for a chat to get the card. */
const RATING_CARD_MIN_MESSAGES = 2;

/** The steps a chat has to have taken for the card, its tasks' steps included. */
const RATING_CARD_MIN_STEPS = 10;

/** The least time between two cards, across every chat of the workspace on this computer. */
export const RATING_CARD_GAP_MS = ms("3 days");

function cardsFile() {
  return path.join(
    getWorkspaceConfig().workspaceMachineDir,
    WORKSPACE_MACHINE_ENTRIES.ratingCards,
  );
}

async function lastRatingCard(): Promise<Date | undefined> {
  const read = await readJsonRecord(cardsFile());
  if (read.kind !== "read") {
    return undefined;
  }
  const at = read.record.lastShownAt;
  const date = typeof at === "string" ? new Date(at) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
}

/** Whether a message is one the person wrote, which a wake's note on a text-less message is not. */
function isPersonMessage(message: SessionMessage.WithParts) {
  return (
    message.role === "user" &&
    message.parts.some((part) => part.type === "text" && part.text.trim())
  );
}

/**
 * Whether a chat is due the card, by its whole rule: enough messages from the
 * person, enough steps, and never a card before. The gap between cards is
 * asked apart, since it reads no chat.
 */
export function ratingCardDue({
  chat,
  sessions,
}: {
  /** The chat's own session. */
  chat: readonly SessionMessage.WithParts[];
  /** Every session of the chat, each with only its own messages. */
  sessions: readonly (readonly SessionMessage.WithParts[])[];
}): boolean {
  if (
    chat.some((message) =>
      message.parts.some((part) => part.type === "data-ratingCard"),
    ) ||
    chat.filter(isPersonMessage).length < RATING_CARD_MIN_MESSAGES
  ) {
    return false;
  }
  const steps = sessions
    .flat()
    .flatMap((message) => message.parts)
    .filter(isToolPart).length;
  return steps >= RATING_CARD_MIN_STEPS;
}

/** Adds the card when the chat is due one and the last card is far enough back. */
export async function addCardIfDue(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<Result<void, unknown>> {
  const now = getCurrentDate();
  const last = await lastRatingCard();
  if (last && now.getTime() - last.getTime() < RATING_CARD_GAP_MS) {
    return ok(undefined);
  }
  // A card waiting on the person means the agent hasn't finished.
  if ((await openAsksUntil(chatId)).asks.length > 0) {
    return ok(undefined);
  }
  const all = await ChatReads.sessions({
    chatId,
    includeChildSessions: true,
  });
  if (all.isErr()) {
    return err(all.error);
  }
  const histories: SessionMessage.WithParts[][] = [];
  for (const session of all.value) {
    const history = await ChatReads.transcript({
      chatId,
      inherited: false,
      sessionId: session.id,
    });
    if (history.isErr()) {
      return err(history.error);
    }
    histories.push(history.value);
  }
  const chat = histories[all.value.findIndex((each) => each.id === sessionId)];
  if (!chat || !ratingCardDue({ chat, sessions: histories })) {
    return ok(undefined);
  }
  const reply = chat.findLast(
    (message): message is SessionMessage.AssistantWithParts =>
      message.role === "assistant",
  );
  if (!reply || reply.metadata.error !== undefined) {
    return ok(undefined);
  }
  const saved = await ChatWrites.savePart(
    {
      data: {},
      metadata: {
        createdAt: now,
        id: StoreId.newPartId(),
        messageId: reply.id,
        sessionId,
      },
      type: "data-ratingCard",
    },
    chatId,
  );
  if (saved.isErr()) {
    return err(saved.error);
  }
  await updateJsonRecord(cardsFile(), () => ({
    lastShownAt: now.toISOString(),
  }));
  return ok(undefined);
}

/**
 * Adds the card asking how a chat went, after the reply it settled on, when
 * the chat is due one and the last card is far enough back. The app adds it
 * without the agent, so it costs no usage and the model never reads it. One
 * settle at a time, so two chats settling together can't both pass the gap.
 * A turn the person stopped isn't a finished reply, so it adds none.
 */
export function startRatingCards(): void {
  void (async () => {
    for await (const settle of publisher.subscribe("chat.settled")) {
      if (
        settle.by !== undefined ||
        getWorkspaceConfig().mayOfferFeedback?.() === false
      ) {
        continue;
      }
      try {
        const added = await addCardIfDue(settle.id, settle.sessionId);
        if (added.isErr()) {
          getWorkspaceConfig().captureException(added.error, {
            area: "rating-card",
          });
        }
      } catch (error) {
        getWorkspaceConfig().captureException(error, { area: "rating-card" });
      }
    }
  })();
}
