import { ok } from "neverthrow";
import { parallel } from "radashi";

import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { Store } from "./store";
import {
  emptyUsageSummary,
  getUsageSummaryFromMessages,
} from "./usage-summary-compute";

export { UsageSummarySchema } from "./usage-summary-compute";

// Loads every message + parts for a task from the store, then summarizes:
// every session of its store, a chat's tasks included, or the one named, a
// task's own spend without what its chat spent before it. Client callers that
// already hold the messages should use getUsageSummaryFromMessages directly
// instead.
export async function getUsageSummary(
  chatId: ChatId,
  {
    sessionId,
    signal,
  }: { sessionId?: StoreId.Session; signal?: AbortSignal } = {},
) {
  const sessionIdsResult = sessionId
    ? ok([sessionId])
    : await Store.getStoreId(chatId, { signal });
  if (sessionIdsResult.isErr()) {
    return emptyUsageSummary();
  }

  const messageGroups = await parallel(
    { limit: 5, signal },
    sessionIdsResult.value,
    async (each) => {
      const messageIdsResult = await Store.getMessageIds(each, chatId, {
        signal,
      });
      if (messageIdsResult.isErr()) {
        return [];
      }

      const messages = await parallel(
        { limit: 10, signal },
        messageIdsResult.value,
        async (messageId) => {
          const result = await Store.getMessageWithParts(
            { messageId, sessionId: each, chatId },
            { signal },
          );
          return result.isOk() ? result.value : null;
        },
      );

      return messages.filter((m) => m !== null);
    },
  );

  return getUsageSummaryFromMessages(messageGroups.flat());
}
