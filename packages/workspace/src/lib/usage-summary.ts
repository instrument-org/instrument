import { parallel } from "radashi";

import { type TaskId } from "../schemas/task-id";
import { Store } from "./store";
import {
  emptyUsageSummary,
  getUsageSummaryFromMessages,
} from "./usage-summary-compute";

export { UsageSummarySchema } from "./usage-summary-compute";

// Loads every message + parts for a task from the store, then summarizes.
// Client callers that already hold the messages should use
// getUsageSummaryFromMessages directly instead.
export async function getTaskUsageSummary(
  taskId: TaskId,
  { signal }: { signal?: AbortSignal } = {},
) {
  const sessionIdsResult = await Store.getStoreId(taskId, { signal });
  if (sessionIdsResult.isErr()) {
    return emptyUsageSummary();
  }

  const messageGroups = await parallel(
    { limit: 5, signal },
    sessionIdsResult.value,
    async (sessionId) => {
      const messageIdsResult = await Store.getMessageIds(sessionId, taskId, {
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
            { messageId, sessionId, taskId },
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
