import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { recordChanges } from "../../../lib/record-changes";
import { changedMessageBatches } from "../../../lib/changed-message-batches";
import { getChatInfo } from "../../../lib/chat-info";
import {
  getTaskUsageSummary,
  UsageSummarySchema,
} from "../../../lib/usage-summary";
import { StoreId } from "../../../schemas/store-id";
import { ChatInfoSchema } from "../../../schemas/chat-info";
import { ChatIdSchema } from "../../../schemas/chat-id";
import { base, toORPCError } from "../../base";
import { liveRead } from "../../live-read";
import { liveTaskActivity } from "./activity";
import { taskAgentStatus } from "./agent-status";
import { taskBackgroundProcesses } from "./background-processes";
import { taskFiles } from "./files";
import { taskState } from "./state";

const byId = base
  .input(z.object({ id: ChatIdSchema }))
  .output(ChatInfoSchema)
  .handler(async ({ errors, input }) => {
    const result = await getChatInfo(input.id);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

const live = {
  byId: base
    .input(z.object({ id: ChatIdSchema }))
    .output(eventIterator(ChatInfoSchema))
    .handler(async function* ({ context, input, signal }) {
      yield* liveRead({
        changes: [
          recordChanges(
            signal,
            (change) =>
              change.id === input.id &&
              (change.kind === "settings" || change.kind === "removed"),
          ),
        ],
        read: () => call(byId, input, { context, signal }),
      });
    }),
};

/** A record's spend across its sessions, or one session's: a task's, say. */
const UsageOfSchema = z.object({
  id: ChatIdSchema,
  sessionId: StoreId.SessionSchema.optional(),
});

const usageSummary = base
  .input(UsageOfSchema)
  .output(UsageSummarySchema)
  .handler(async ({ input, signal }) =>
    getTaskUsageSummary(input.id, {
      signal,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }),
  );

const liveUsageSummary = base
  .input(UsageOfSchema)
  .output(eventIterator(UsageSummarySchema))
  .handler(async function* ({ context, input, signal }) {
    // Coalesce this task's message/part events so a streaming turn recomputes
    // the (whole-task) summary once per batch instead of once per event.
    const batches = changedMessageBatches(input, signal);
    try {
      yield call(usageSummary, input, { context, signal });
      for await (const _batch of batches) {
        yield call(usageSummary, input, { context, signal });
      }
    } finally {
      await batches.return();
    }
  });

export const task = {
  agentStatus: taskAgentStatus,
  backgroundProcesses: taskBackgroundProcesses,
  byId,
  files: taskFiles,
  live: {
    ...live,
    activity: liveTaskActivity,
    usageSummary: liveUsageSummary,
  },
  state: taskState,
};
