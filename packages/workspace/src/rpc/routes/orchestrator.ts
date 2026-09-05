import { z } from "zod";

import { listChildTasks } from "../../lib/orchestrator/children";
import { ensureOrchestrator } from "../../lib/orchestrator/ensure";
import { StoreId } from "../../schemas/store-id";
import { TaskSchema } from "../../schemas/task";
import { TaskIdSchema } from "../../schemas/task-id";
import { base, toORPCError } from "../base";

/** The tasks an orchestrator created, newest activity first. */
const children = base
  .input(z.object({ id: TaskIdSchema }))
  .output(TaskSchema.array())
  .handler(({ input }) => listChildTasks(input.id));

/** The orchestrator task and the session to talk to it in, created on first use. */
const ensure = base
  .output(
    z.object({
      sessionId: StoreId.SessionSchema,
      taskId: TaskIdSchema,
    }),
  )
  .handler(async ({ context, errors }) => {
    const result = await ensureOrchestrator();
    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }
    return result.value;
  });

export const orchestrator = {
  children,
  ensure,
};
