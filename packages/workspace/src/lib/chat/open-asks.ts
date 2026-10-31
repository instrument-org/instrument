import { type ChatId } from "../../schemas/chat-id";
import { type Ask, type QuestionAsk } from "../../schemas/chat-state";
import { type StoreId } from "../../schemas/store-id";
import { ASK_FRESH_MS } from "@instrument-org/shared";

import { asksOf, chatAskStates } from "./asks";

/**
 * What a chat waits on the person for, every computer's, as this device's
 * readers draw it: its permission cards and the questions its agent asked,
 * both read from where their asks stand (`askStates`).
 */

/** The chat's open asks, its cards and its questions, oldest first. */
export async function openAsks(chatId: ChatId): Promise<Ask[]> {
  return (await openAsksUntil(chatId)).asks;
}

/**
 * The chat's open asks, and the moment the first answer still pending on
 * one goes stale, when they read differently with no record changing
 * (`isFreshAsk`); none when no answer is pending.
 */
export async function openAsksUntil(
  chatId: ChatId,
): Promise<{ asks: Ask[]; staleAt?: number }> {
  const states = await chatAskStates(chatId);
  const stale = states.flatMap(({ pending }) =>
    pending ? [pending.at.getTime() + ASK_FRESH_MS + 1] : [],
  );
  return {
    asks: await asksOf(states),
    ...(stale.length > 0 && { staleAt: Math.min(...stale) }),
  };
}

/** The chat's open questions, oldest first. */
export async function openQuestions(chatId: ChatId): Promise<QuestionAsk[]> {
  return (await openAsks(chatId)).filter(
    (ask): ask is QuestionAsk => ask.kind === "question",
  );
}

/** The chat's open asks a session is on, waiting to be woken with the answer, oldest first. */
export async function openAsksOf(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<Ask[]> {
  return (await openAsks(chatId)).filter((ask) =>
    ask.askers.some((asker) => asker.sessionId === sessionId),
  );
}
