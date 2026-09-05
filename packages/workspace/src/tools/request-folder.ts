import ms from "ms";
import { z } from "zod";

import { executeError } from "../lib/execute-error";
import { MOUNT } from "../mount-points";
import { FolderAttachment } from "../schemas/folder-attachment";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

/**
 * Ask the user for a folder the work needs.
 *
 * Interactive, like `choose`: the call parks the turn, the user picks a folder
 * in the Mac's own dialog, the folder is attached to the conversation with the
 * access they chose, and the call answers with where it is mounted. The
 * orchestrator never learns the host path; it gets a mount name it can hand to
 * a task. A user who declines answers that too, so the agent can say so
 * rather than wait.
 */
export const RequestFolder = setupTool({
  inputSchema: BaseInputSchema.extend({
    access: FolderAttachment.AccessSchema.meta({
      description:
        "What the work needs: read-only to read the folder, read-write when a task will create or change files in it.",
    }),
    reason: z.string().trim().min(1).max(300).meta({
      description:
        "One sentence, addressed to the user, saying which folder you need and what for: 'Your Desktop, to put the test file there.'",
    }),
  }),
  name: "request_folder",
  outputSchema: z.discriminatedUnion("status", [
    z.object({
      access: FolderAttachment.AccessSchema,
      mountPoint: z.string(),
      status: z.literal("granted"),
    }),
    z.object({ status: z.literal("declined") }),
  ]),
}).create({
  description: `Ask the user for a folder you do not have. The conversation waits while they pick one; it then arrives mounted under ${MOUNT.attachedFolders}, and the answer names the mount, which you pass to a task with --folder. Ask for one folder at a time, and only when the work cannot proceed without it.`,
  execute: () => {
    return Promise.resolve(executeError("Not implemented"));
  },
  readOnly: true,
  timeoutMs: ms("1 second"),
  toModelOutput: ({ output }) => ({
    type: "text",
    value:
      output.status === "granted"
        ? `The user attached the folder. It is mounted at ${output.mountPoint} (${output.access}); pass it to a task as --folder ${output.mountPoint}${output.access === "read-write" ? ":rw" : ""}.`
        : "The user declined. Say what you cannot do without the folder and carry on with what you can.",
  }),
});
