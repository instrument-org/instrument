import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { eventIterator } from "@orpc/server";
import { isEqual } from "radashi";
import { z } from "zod";

import { getTaskLiveState } from "../../../lib/get-task-live-state";
import { TaskIdSchema } from "../../../schemas/task-id";
import { TaskLiveStateSchema } from "../../../schemas/task-live-state";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";

const byId = base
  .input(z.object({ id: TaskIdSchema }))
  .output(eventIterator(TaskLiveStateSchema))
  .handler(async function* ({ context, errors, input, signal }) {
    const { workspaceRef } = context;

    const getOrThrow = async () => {
      const result = await getTaskLiveState({
        id: input.id,
        workspaceRef,
      });

      if (result.isErr()) {
        throw toORPCError(result.error, errors);
      }

      return result.value;
    };

    let previousState = await getOrThrow();
    yield previousState;

    const relevantEvents = [
      "taskLiveState.session.added",
      "taskLiveState.session.done",
      "taskLiveState.session.tagsChanged",
    ] as const;

    const subscriptions = relevantEvents.map((eventName) =>
      publisher.subscribe(eventName, { signal }),
    );

    for await (const payload of mergeGenerators(subscriptions)) {
      if (
        "id" in payload &&
        payload.id !== input.id &&
        !payload.id.endsWith(input.id)
      ) {
        continue;
      }

      const currentState = await getOrThrow();

      if (!isEqual(currentState, previousState)) {
        previousState = currentState;
        yield currentState;
      }
    }
  });

const aliveAgentCount = base
  .input(z.void())
  .output(z.object({ count: z.number() }))
  .handler(({ context }) => {
    const { sessionRefsByTaskId } = context.workspaceRef.getSnapshot().context;
    let count = 0;

    for (const sessionRefs of sessionRefsByTaskId.values()) {
      for (const sessionRef of sessionRefs) {
        if (sessionRef.getSnapshot().hasTag("agent.alive")) {
          count += 1;
        }
      }
    }

    return { count };
  });

const byIds = base
  .input(z.object({ ids: TaskIdSchema.array() }))
  .output(TaskLiveStateSchema.array())
  .handler(async ({ context, errors, input }) => {
    const { workspaceRef } = context;
    const results = [];

    for (const id of input.ids) {
      const result = await getTaskLiveState({
        id,
        workspaceRef,
      });

      if (result.isErr()) {
        throw toORPCError(result.error, errors);
      }

      results.push(result.value);
    }

    return results;
  });

export const taskLiveState = {
  aliveAgentCount,
  byIds,
  live: {
    byId,
  },
};
