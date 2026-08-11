import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  CurrentFileInfoSchema,
  getCurrentFileInfo,
} from "../../../lib/get-file-info";
import { getTaskFiles, TaskFilesSchema } from "../../../lib/get-task-files";
import { WatchedFileSchema, watchFileInfo } from "../../../lib/watch-file-info";
import { WorkspaceFilePathSchema } from "../../../schemas/paths";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";

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

const fileInfo = base
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

export const taskFiles = {
  fileInfo,
  list,
  live: {
    // One file, watched while something is looking at it. Deliberately not the
    // standing index: exactly one thing in the app is live at a time, and it is
    // the file on screen.
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
    list: base
      .input(
        z.object({
          taskId: TaskIdSchema,
        }),
      )
      .output(eventIterator(TaskFilesSchema))
      // A walk on subscribe and another when a turn ends, rather than a
      // standing index over the task directory. The list is a browsing surface
      // the user opens; it does not need to know about a file the moment it
      // lands, and the folder this will eventually be walking is one the user
      // picked, which a recursive watcher has no business indexing.
      .handler(async function* ({ context, input, signal }) {
        const changes = publisher.subscribe("task.files.changed", { signal });
        yield call(list, input, { context, signal });

        for await (const payload of changes) {
          if (payload.id === input.taskId) {
            yield call(list, input, { context, signal });
          }
        }
      }),
  },
};
