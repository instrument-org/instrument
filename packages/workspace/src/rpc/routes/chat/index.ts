import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { recordChanges } from "../../../lib/record-changes";
import { changedMessageBatches } from "../../../lib/changed-message-batches";
import { getChatInfo } from "../../../lib/chat-info";
import {
  getUsageSummary,
  UsageSummarySchema,
} from "../../../lib/usage-summary";
import { StoreId } from "../../../schemas/store-id";
import { ChatInfoSchema } from "../../../schemas/chat-info";
import { ChatIdSchema } from "../../../schemas/chat-id";
import { base, toORPCError } from "../../base";
import { liveRead } from "../../live-read";
import { liveChatActivity } from "./activity";
import { agentStatus } from "./agent-status";
import { chatBackgroundProcesses } from "./background-processes";
import { chatFiles } from "./files";
import { chatState } from "./state";

const info = base
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
  info: base
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
        read: () => call(info, input, { context, signal }),
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
    getUsageSummary(input.id, {
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

/**
 * What is read of one chat beside its list row: its settings (`info`), its
 * state, the files its agents name, its background processes and its spend,
 * plus the agents alive across chats. Spread into `chats`.
 */
export const chatRoutes = {
  agentStatus,
  backgroundProcesses: chatBackgroundProcesses,
  files: chatFiles,
  info,
  live: {
    ...live,
    activity: liveChatActivity,
    usageSummary: liveUsageSummary,
  },
  state: chatState,
};
