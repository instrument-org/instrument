import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { MAX_PROMPT_STORAGE_LENGTH } from "../../../constants";
import { taskDir } from "../../../lib/task-dir-utils";
import {
  getTaskState,
  setTaskState,
  updateTaskPane,
} from "../../../lib/task-state-store";
import { TaskIdSchema } from "../../../schemas/task-id";
import { TaskPane } from "../../../schemas/task-pane";
import { TaskStateSchema } from "../../../schemas/task-state";
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

    // The pane is read back off this stream, so a write has to push. A draft is
    // not: it is seeded once with the rest of the task's state and never read
    // again, so publishing one would wake every reader of this task once a
    // second while someone types.
    if (Object.keys(stateToSave).some((key) => key !== "promptDraft")) {
      publisher.publish("task.stateUpdated", { id: taskId });
    }
  });

/**
 * Apply one pane operation to whatever the pane currently is.
 *
 * Deliberately not `set` with a pane: the client computes from the pane it last
 * saw, and `show` writes the same field from the agent's turn, so a snapshot
 * would erase a tab the agent opened between the client's read and its write.
 * `updateTaskPane` runs the reducer inside the per-task write queue, which is
 * the same queue `show` goes through, so the two serialize.
 */
const applyPaneOperation = base
  .input(
    z.object({
      id: TaskIdSchema,
      operation: TaskPane.OperationSchema,
    }),
  )
  .output(TaskPane.Schema)
  .handler(async ({ input }) => {
    const pane = await updateTaskPane(taskDir(input.id), (current) =>
      TaskPane.applyOperation(current, input.operation),
    );

    publisher.publish("task.stateUpdated", { id: input.id });

    return pane;
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

      // Both channels: a folder attach lands as a task update, a pane change
      // as a state update, and this stream is the reader of each.
      const updates = mergeGenerators([
        publisher.subscribe("task.updated", { signal }),
        publisher.subscribe("task.stateUpdated", { signal }),
      ]);

      for await (const payload of updates) {
        if (payload.id === input.id) {
          yield call(get, input, { context, signal });
        }
      }
    }),
};

export const taskState = {
  applyPaneOperation,
  get,
  live,
  removeFolder,
  set,
};
