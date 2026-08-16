import { z } from "zod";

import { getTaskAgentStatus } from "../../../lib/get-task-agent-status";
import { TaskAgentStatusSchema } from "../../../schemas/task-agent-status";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base, toORPCError } from "../../base";

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
  .output(TaskAgentStatusSchema.array())
  .handler(({ context, errors, input }) => {
    const { workspaceRef } = context;
    const results = [];

    for (const id of input.ids) {
      const result = getTaskAgentStatus({
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

export const taskAgentStatus = {
  aliveAgentCount,
  byIds,
};
