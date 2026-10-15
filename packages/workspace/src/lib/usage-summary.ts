import { parallel } from "radashi";

import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { ChatReads } from "./chat-reads";
import {
  emptyUsageSummary,
  getUsageSummaryFromMessages,
} from "./usage-summary-compute";

export { UsageSummarySchema } from "./usage-summary-compute";

// Loads every message + parts for a task, then summarizes: every session of
// the chat, its tasks included, or the one named, a task's own spend without
// what its chat spent before it. Client callers that already hold the
// messages should use getUsageSummaryFromMessages directly instead.
export async function getUsageSummary(
  chatId: ChatId,
  {
    sessionId,
    signal,
  }: { sessionId?: StoreId.Session; signal?: AbortSignal } = {},
) {
  let sessionIds: StoreId.Session[];
  if (sessionId) {
    sessionIds = [sessionId];
  } else {
    const sessions = await ChatReads.sessions({
      chatId,
      includeChildSessions: true,
      signal,
    });
    if (sessions.isErr()) {
      return emptyUsageSummary();
    }
    sessionIds = sessions.value.map((session) => session.id);
  }

  const messageGroups = await parallel(
    { limit: 5, signal },
    sessionIds,
    async (each) => {
      // A session's own messages: a task's spend is its own, and its chat's
      // are counted under the chat.
      const messages = await ChatReads.transcript({
        chatId,
        inherited: false,
        sessionId: each,
        signal,
      });
      return messages.isOk() ? messages.value : [];
    },
  );

  return getUsageSummaryFromMessages(messageGroups.flat());
}
