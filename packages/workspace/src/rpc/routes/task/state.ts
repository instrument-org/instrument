import { z } from "zod";

import { MAX_PROMPT_STORAGE_LENGTH } from "../../../constants";
import { createAppConfig } from "../../../lib/app-config/create";
import { taskDir } from "../../../lib/app-dir-utils";
import {
  getProjectState,
  ProjectStateSchema,
  setProjectState,
} from "../../../lib/project-state-store";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base } from "../../base";

const get = base
  .input(z.object({ id: TaskIdSchema }))
  .output(ProjectStateSchema)
  .handler(async ({ input }) => {
    const appConfig = createAppConfig({ id: input.id });

    return getProjectState(taskDir(appConfig));
  });

const set = base
  .input(
    z.object({
      id: TaskIdSchema,
      state: ProjectStateSchema.partial(),
    }),
  )
  .output(z.void())
  .handler(async ({ input }) => {
    const appConfig = createAppConfig({ id: input.id });

    const stateToSave = { ...input.state };

    if (
      stateToSave.promptDraft &&
      stateToSave.promptDraft.length > MAX_PROMPT_STORAGE_LENGTH
    ) {
      delete stateToSave.promptDraft;
    }

    await setProjectState(taskDir(appConfig), stateToSave);
  });

export const projectState = {
  get,
  set,
};
