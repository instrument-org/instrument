import { z } from "zod";

import { resolveWorkspaceFilePaths } from "../../../lib/resolve-workspace-file-path";
import { WorkspaceFilePathSchema } from "../../../schemas/paths";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base } from "../../base";

/**
 * Where the files a task named sit on the computer, by the path the task
 * wrote. The person's side of the window works in those paths: a viewer
 * reads the bytes by one, a tab is addressed by one, and the agent's own
 * paths are translated once, here, on their way to the screen. Null for a
 * path outside everything the task can reach.
 */
const hostPaths = base
  .input(
    z.object({
      filePaths: z.array(WorkspaceFilePathSchema),
      taskId: TaskIdSchema,
    }),
  )
  .output(z.record(z.string(), z.string().nullable()))
  .handler(async ({ input: { filePaths, taskId } }) =>
    Object.fromEntries(await resolveWorkspaceFilePaths({ filePaths, taskId })),
  );

export const taskFiles = {
  hostPaths,
};
