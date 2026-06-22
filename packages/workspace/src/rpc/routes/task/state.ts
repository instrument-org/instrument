import { z } from "zod";

import { MAX_PROMPT_STORAGE_LENGTH } from "../../../constants";
import { taskDir } from "../../../lib/app-dir-utils";
import {
  getTaskState,
  setTaskState,
  TaskStateSchema,
} from "../../../lib/task-state-store";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base } from "../../base";

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

export const projectState = {
  get,
  set,
};
