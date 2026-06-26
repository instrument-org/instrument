import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { addPin, getPinnedTasks, getPins, removePin } from "../../../lib/pins";
import { TaskSchema } from "../../../schemas/task";
import { TaskIdSchema } from "../../../schemas/task-id";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";

const add = base
  .input(z.object({ id: TaskIdSchema }))
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    // addPin writes pinnedAt to the task settings, which publishes task.updated.
    const result = await addPin(input.id);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    context.workspaceConfig.captureEvent("pin.added");
  });

const remove = base
  .input(z.object({ id: TaskIdSchema }))
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const result = await removePin(input.id);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    context.workspaceConfig.captureEvent("pin.removed");
  });

const live = {
  listTaskIds: base
    .output(eventIterator(TaskIdSchema.array()))
    .handler(async function* ({ signal }) {
      yield await getPins();

      const taskUpdated = publisher.subscribe("task.updated", { signal });
      const taskRemoved = publisher.subscribe("task.removed", { signal });

      for await (const _payload of mergeGenerators([
        taskUpdated,
        taskRemoved,
      ])) {
        yield await getPins();
      }
    }),
  listTasks: base
    .output(eventIterator(TaskSchema.array()))
    .handler(async function* ({ signal }) {
      yield await getPinnedTasks();

      const taskUpdated = publisher.subscribe("task.updated", { signal });
      const taskRemoved = publisher.subscribe("task.removed", { signal });

      for await (const _payload of mergeGenerators([
        taskUpdated,
        taskRemoved,
      ])) {
        yield await getPinnedTasks();
      }
    }),
};

export const pin = {
  add,
  live,
  remove,
};
