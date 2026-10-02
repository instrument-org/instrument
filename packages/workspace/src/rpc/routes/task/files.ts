import { eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  CurrentFileInfoSchema,
  getCurrentFileInfo,
} from "../../../lib/get-file-info";
import { getTaskFiles, TaskFilesSchema } from "../../../lib/get-task-files";
import { resolveWorkspaceFilePaths } from "../../../lib/resolve-workspace-file-path";
import { WatchedFileSchema, watchFileInfo } from "../../../lib/watch-file-info";
import { WorkspaceFilePathSchema } from "../../../schemas/paths";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base, toORPCError } from "../../base";

const list = base
  .input(
    z.object({
      taskId: TaskIdSchema,
    }),
  )
  .output(TaskFilesSchema)
  .handler(async ({ errors, input: { taskId } }) => {
    const result = await getTaskFiles(taskId);

    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

const info = base
  .input(
    z.object({
      filePath: WorkspaceFilePathSchema,
      taskId: TaskIdSchema,
    }),
  )
  .output(CurrentFileInfoSchema)
  .handler(async ({ errors, input: { filePath, taskId } }) => {
    const result = await getCurrentFileInfo({
      filePath,
      taskId,
    });

    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

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
  info,
  list,
  live: {
    // One file, watched while something is looking at it. The only live thing
    // in the app, and deliberately so: the browsing surface over the whole
    // directory polls itself while it is open (`TaskFiles`), because a poll
    // costs what is on screen and a watcher costs the tree -- including the
    // one the user is about to point us at, which can be a monorepo.
    info: base
      .input(
        z.object({
          filePath: WorkspaceFilePathSchema,
          taskId: TaskIdSchema,
        }),
      )
      .output(eventIterator(WatchedFileSchema))
      .handler(async function* ({ input, signal }) {
        yield* watchFileInfo({ ...input, signal });
      }),
  },
};
