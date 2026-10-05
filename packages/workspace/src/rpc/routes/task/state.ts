import { z } from "zod";

import { attachFolder as attachFolderToTask } from "../../../lib/attach-folder";
import { folderReach } from "../../../lib/chat/folder-reach";
import { taskDir } from "../../../lib/task-dir-utils";
import { getTaskState, setTaskState } from "../../../lib/task-record";
import { FolderAttachment } from "../../../schemas/folder-attachment";
import { TaskIdSchema } from "../../../schemas/task-id";
import { TaskStateSchema } from "../../../schemas/task-state";
import { base } from "../../base";

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

    await setTaskState(taskDir(taskId), input.state);
  });

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
  set,
};
