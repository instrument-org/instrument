import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { getTask } from "../../../lib/get-tasks";
import {
  addPin,
  getPins,
  removePin,
  setPins,
} from "../../../lib/workspace-store";
import { type Task, TaskSchema } from "../../../schemas/task";
import { type TaskId, TaskIdSchema } from "../../../schemas/task-id";
import { type WorkspaceConfig } from "../../../types";
import { base, toORPCError } from "../../base";
import { publisher } from "../../publisher";

// Resolves the pinned ids to tasks, dropping (and persisting away) any that no
// longer exist, sorted most-recently-updated first.
async function resolvePinnedTasks(
  pinnedIds: TaskId[],
  workspaceConfig: WorkspaceConfig,
): Promise<Task[]> {
  const tasks: Task[] = [];
  for (const id of pinnedIds) {
    const result = await getTask(id, workspaceConfig);
    if (result.isOk()) {
      tasks.push(result.value);
    }
  }

  if (tasks.length !== pinnedIds.length) {
    // Self-heal: a pinned task was deleted out from under us. Best-effort.
    await setPins(tasks.map((task) => task.id));
  }

  return tasks.toSorted(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

const add = base
  .input(z.object({ id: TaskIdSchema }))
  .output(z.void())
  .handler(async ({ context, errors, input }) => {
    const result = await addPin(input.id);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    publisher.publish("pin.updated", null);
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
    publisher.publish("pin.updated", null);
    context.workspaceConfig.captureEvent("pin.removed");
  });

const live = {
  listTaskIds: base
    .output(eventIterator(TaskIdSchema.array()))
    .handler(async function* ({ signal }) {
      yield await getPins().unwrapOr([]);

      const pinUpdated = publisher.subscribe("pin.updated", { signal });
      const taskRemoved = publisher.subscribe("task.removed", { signal });

      for await (const _payload of mergeGenerators([pinUpdated, taskRemoved])) {
        yield await getPins().unwrapOr([]);
      }
    }),
  listTasks: base
    .output(eventIterator(TaskSchema.array()))
    .handler(async function* ({ context, signal }) {
      const pins = await getPins().unwrapOr([]);
      yield await resolvePinnedTasks(pins, context.workspaceConfig);

      const pinUpdated = publisher.subscribe("pin.updated", { signal });
      const taskUpdated = publisher.subscribe("task.updated", { signal });
      const taskRemoved = publisher.subscribe("task.removed", { signal });

      for await (const _payload of mergeGenerators([
        pinUpdated,
        taskUpdated,
        taskRemoved,
      ])) {
        const next = await getPins().unwrapOr([]);
        yield await resolvePinnedTasks(next, context.workspaceConfig);
      }
    }),
};

export const pin = {
  add,
  live,
  remove,
};
