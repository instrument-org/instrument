import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { ActiveReplays } from "../../lib/active-replays";
import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { base } from "../base";
import { publisher } from "../publisher";

const cancel = base
  .input(
    z.object({
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.void())
  .handler(({ input }) => {
    const id = ActiveReplays.getTaskId(input.sessionId);
    ActiveReplays.cancel(input.sessionId);
    if (id) {
      publisher.publish("replay.changed", {
        id,
        isActive: false,
        sessionId: input.sessionId,
      });
    }
  });

const status = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .output(z.object({ isActive: z.boolean() }))
  .handler(({ input }) => {
    return { isActive: ActiveReplays.isActive(input.sessionId) };
  });

const live = {
  status: base
    .input(z.object({ sessionId: StoreId.SessionSchema }))
    .output(eventIterator(z.object({ isActive: z.boolean() })))
    .handler(async function* ({ context, input, signal }) {
      yield call(status, input, { context, signal });

      for await (const payload of publisher.subscribe("replay.changed", {
        signal,
      })) {
        if (payload.sessionId === input.sessionId) {
          yield { isActive: payload.isActive };
        }
      }
    }),
  statusByTaskId: base
    .input(z.object({ id: TaskIdSchema }))
    .output(
      eventIterator(
        z.object({ activeSessionIds: z.array(StoreId.SessionSchema) }),
      ),
    )
    .handler(async function* ({ input, signal }) {
      yield {
        activeSessionIds: ActiveReplays.getActiveSessionIds(input.id),
      };

      for await (const payload of publisher.subscribe("replay.changed", {
        signal,
      })) {
        if (payload.id === input.id) {
          yield {
            activeSessionIds: ActiveReplays.getActiveSessionIds(input.id),
          };
        }
      }
    }),
};

export const replay = { cancel, live, status };
