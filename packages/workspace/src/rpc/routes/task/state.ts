import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { call, eventIterator } from "@orpc/server";
import { z } from "zod";

import { MAX_PROMPT_STORAGE_LENGTH } from "../../../constants";
import { attachFolder as attachFolderToTask } from "../../../lib/attach-folder";
import { folderReach } from "../../../lib/orchestrator/folder-reach";
import { taskDir } from "../../../lib/task-dir-utils";
import { getTaskState, setTaskState } from "../../../lib/task-record";
import { FolderAttachment } from "../../../schemas/folder-attachment";
import { TaskIdSchema } from "../../../schemas/task-id";
import { TaskStateSchema } from "../../../schemas/task-state";
import { base } from "../../base";
import { publisher } from "../../publisher";

const get = base
  .input(z.object({ id: TaskIdSchema }))
  .output(TaskStateSchema)
  .handler(async ({ input }) => {
    const state = await getTaskState(taskDir(input.id));
    // A chat's folders as it reaches them, which is more than it holds.
    return { ...state, attachedFolders: await folderReach(input.id, state) };
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

    // The state is read back off this stream, so a write has to push. A draft is
    // not: it is seeded once with the rest of the task's state and never read
    // again, so publishing one would wake every reader of this task once a
    // second while someone types.
    if (Object.keys(stateToSave).some((key) => key !== "promptDraft")) {
      publisher.publish("task.stateUpdated", { id: taskId });
    }
  });

const live = {
  get: base
    .input(z.object({ id: TaskIdSchema }))
    .output(eventIterator(TaskStateSchema))
    .handler(async function* ({ context, input, signal }) {
      yield call(get, input, { context, signal });

      // Both channels: a folder attach lands as a task update, a held tab
      // change as a state update, and this stream is the reader of each.
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

/**
 * Attach a folder outside of a message: what answering an agent's request for
 * one does. The message path stays the way a folder arrives with something the
 * user typed. The agent may read and write it; what a task it starts may do
 * there is the agent's to say when it hands the folder over.
 */
const attachFolder = base
  .input(z.object({ id: TaskIdSchema, path: z.string() }))
  .output(FolderAttachment.Schema)
  .handler(async ({ input }) => {
    const attached = await attachFolderToTask({
      access: "read-write",
      path: input.path,
      taskId: input.id,
    });
    // Named the way the agent reaches it, beside the folders a chat reaches
    // without holding.
    const reached = Object.values(await folderReach(input.id)).find(
      (folder) => folder.path === attached.path,
    );
    return reached ?? attached;
  });

export const taskState = {
  attachFolder,
  get,
  live,
  set,
};
