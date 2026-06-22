import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import {
  CurrentFileInfoSchema,
  getCurrentFileInfo,
} from "../../../lib/get-file-info";
import {
  getProjectFiles,
  ProjectFilesSchema,
} from "../../../lib/get-project-files";
import {
  getCurrentProjectFiles,
  startWatchingProjectFiles,
} from "../../../lib/project-file-watcher";
import { RelativeProjectPathSchema } from "../../../schemas/paths";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";

const list = base
  .input(
    z.object({
      taskId: TaskIdSchema,
    }),
  )
  .output(ProjectFilesSchema)
  .handler(async ({ errors, input: { taskId } }) => {
    // Serve the live in-memory index when a watcher is active; otherwise fall
    // back to a fresh walk of disk.
    const live = getCurrentProjectFiles(taskId);
    if (live) {
      return live;
    }

    const result = await getProjectFiles(taskId);

    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

const fileInfo = base
  .input(
    z.object({
      filePath: RelativeProjectPathSchema,
      taskId: TaskIdSchema,
    }),
  )
  .output(CurrentFileInfoSchema)
  .handler(({ errors, input: { filePath, taskId } }) => {
    const result = getCurrentFileInfo({
      filePath,
      taskId,
    });

    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

export const projectFiles = {
  fileInfo,
  list,
  live: {
    list: base
      .input(
        z.object({
          taskId: TaskIdSchema,
        }),
      )
      .output(eventIterator(ProjectFilesSchema))
      .handler(async function* ({ context, input, signal }) {
        const release = startWatchingProjectFiles({
          id: input.taskId,
          workspaceConfig: context.workspaceConfig,
        });

        try {
          const changes = publisher.subscribe("project.files.changed", {
            signal,
          });
          yield call(list, input, { context, signal });

          for await (const payload of changes) {
            if (payload.id === input.taskId) {
              yield call(list, input, { context, signal });
            }
          }
        } finally {
          release();
        }
      }),
  },
};
