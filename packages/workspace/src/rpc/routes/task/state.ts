import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { MAX_PROMPT_STORAGE_LENGTH } from "../../../constants";
import { taskDir } from "../../../lib/task-dir-utils";
import {
  getTaskState,
  setTaskState,
  TaskStateSchema,
} from "../../../lib/task-state-store";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base } from "../../base";
import { publisher } from "../../publisher";

const get = base
  .input(z.object({ id: TaskIdSchema }))
  .output(TaskStateSchema)
  .handler(async ({ input }) => {
    const taskId = input.id;

    return getTaskState(taskDir(taskId));
  });

const set = base
  .input(
    z.object({
      id: TaskIdSchema,
      state: TaskStateSchema.partial(),
    }),
  )
  .output(z.void())
  .handler(async ({ input }) => {
    const taskId = input.id;

    const stateToSave = { ...input.state };

    if (
      stateToSave.promptDraft &&
      stateToSave.promptDraft.length > MAX_PROMPT_STORAGE_LENGTH
    ) {
      delete stateToSave.promptDraft;
    }

    await setTaskState(taskDir(taskId), stateToSave);
  });

const removeFolder = base
  .input(z.object({ folderId: z.string(), id: TaskIdSchema }))
  .output(z.void())
  .handler(async ({ input }) => {
    const dir = taskDir(input.id);
    const current = await getTaskState(dir);
    if (!current.attachedFolders) {
      return;
    }
    const updated = Object.fromEntries(
      Object.entries(current.attachedFolders).filter(
        ([, folder]) => folder.id !== input.folderId,
      ),
    );

    await setTaskState(dir, { attachedFolders: updated });
    publisher.publish("task.updated", { id: input.id });
  });

const live = {
  get: base
    .input(z.object({ id: TaskIdSchema }))
    .output(eventIterator(TaskStateSchema))
    .handler(async function* ({ context, input, signal }) {
      yield call(get, input, { context, signal });

      const updates = publisher.subscribe("task.updated", { signal });

      for await (const payload of updates) {
        if (payload.id === input.id) {
          yield call(get, input, { context, signal });
        }
      }
    }),
};

export const taskState = {
  get,
  live,
  removeFolder,
  set,
};
