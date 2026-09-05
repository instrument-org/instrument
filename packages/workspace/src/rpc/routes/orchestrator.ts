import { z } from "zod";

import { listChildTasks } from "../../lib/orchestrator/children";
import { ensureOrchestrator } from "../../lib/orchestrator/ensure";
import {
  FolderListingSchema,
  listOrchestratorFolder,
} from "../../lib/orchestrator/list-folder";
import { ensureOutputFolder } from "../../lib/orchestrator/output-folder";
import { MOUNT } from "../../mount-points";
import { StoreId } from "../../schemas/store-id";
import { TaskSchema } from "../../schemas/task";
import { TaskIdSchema } from "../../schemas/task-id";
import { base, toORPCError } from "../base";

/** The tasks an orchestrator created, newest activity first. */
const children = base
  .input(z.object({ id: TaskIdSchema }))
  .output(TaskSchema.array())
  .handler(({ input }) => listChildTasks(input.id));

/**
 * The orchestrator task, the session to talk to it in, and the mount of the
 * folder its outcomes land in by default, all created on first use.
 */
const ensure = base
  .output(
    z.object({
      outputFolder: z.string(),
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
    const mountName = await ensureOutputFolder(result.value.taskId);
    return {
      ...result.value,
      outputFolder: `${MOUNT.attachedFolders}/${mountName}`,
    };
  });

/** One folder the orchestrator can reach, as the person browsing it sees it. */
const listFolder = base
  .input(z.object({ id: TaskIdSchema, path: z.string() }))
  .output(FolderListingSchema)
  .handler(({ input }) =>
    listOrchestratorFolder({ path: input.path, taskId: input.id }),
  );

export const orchestrator = {
  children,
  ensure,
  listFolder,
};
