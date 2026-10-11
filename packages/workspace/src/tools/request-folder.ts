import { APP_NAME } from "@instrument-org/shared";
import ms from "ms";
import { z } from "zod";

import { executeError } from "../lib/execute-error";
import { MOUNT } from "../mount-points";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

/**
 * Ask the user for a folder the work needs.
 *
 * Interactive, like `choose`: the call parks the turn, the user picks a folder
 * in the Mac's own dialog, the folder is attached to the conversation, and the
 * call answers with where it is mounted. Given a folder of the chat's own that
 * macOS refused, the dialog opens at it, since a folder picked there is one
 * the Mac lets the app into from then on. The
 * chat never learns the host path; it gets a mount name it can hand to
 * a task. A user who declines answers that too, so the agent can say so
 * rather than wait.
 */
export const RequestFolder = setupTool({
  inputSchema: BaseInputSchema.extend({
    reason: z.string().trim().min(1).max(300).meta({
      description:
        "One sentence, addressed to the user, saying which folder you need and what for: 'Your Desktop, to put the test file there.'",
    }),
    folder: z
      .string()
      .optional()
      .meta({
        description: `A folder under ${MOUNT.folders} that macOS has not let ${APP_NAME} into, as a command refusing it named it. The panel opens at that folder, so letting ${APP_NAME} in is one press.`,
      }),
  }),
  name: "request_folder",
  outputSchema: z.discriminatedUnion("status", [
    z.object({
      mountPoint: z.string(),
      status: z.literal("granted"),
    }),
    z.object({ status: z.literal("declined") }),
  ]),
}).create({
  description: `Ask the user for a folder you do not reach: one outside their home folder (an external drive, another volume), or, given as \`folder\`, one of yours that macOS has not let ${APP_NAME} into. The conversation waits while they pick one; it then arrives mounted under ${MOUNT.folders}, and the answer names the mount. Ask for one folder at a time, and only when the work cannot proceed without it.`,
  // Reached only in a fork, where a question has nobody to park for.
  execute: () => {
    return Promise.resolve(
      executeError(
        "You are running in the background, where nobody sees a question: only the chat asks the user. Do what you can, and end your last message with a needs fence naming what you need.",
      ),
    );
  },
  readOnly: true,
  timeoutMs: ms("1 second"),
  toModelOutput: ({ output }) => ({
    type: "text",
    value:
      output.status === "granted"
        ? `The user attached the folder. It is mounted at ${output.mountPoint}, for you and every task you start.`
        : "The user declined. Say what you cannot do without the folder and carry on with what you can.",
  }),
});
