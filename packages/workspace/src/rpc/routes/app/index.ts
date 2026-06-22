import { z } from "zod";

import { getApp } from "../../../lib/get-tasks";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base, toORPCError } from "../../base";
import { appState } from "./state";

const byId = base
  .input(z.object({ id: TaskIdSchema }))
  .handler(async ({ context, errors, input }) => {
    const result = await getApp(input.id, context.workspaceConfig);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }

    return result.value;
  });

export const app = {
  byId,
  state: appState,
};
