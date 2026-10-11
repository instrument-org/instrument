import { APP_NAME_SLUG } from "@instrument-org/shared";
import ms from "ms";
import { z } from "zod";

import { executeError } from "../lib/execute-error";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

/**
 * Ask the user for a folder the work needs.
 *
 * Interactive, like `choose`: the call parks the turn and the chat shows a
 * card. Given the folder the agent needs, the card offers to allow it in this
 * chat or always, or to pick another in the Mac's own panel; without one, it
 * offers only the panel. A user who declines answers that too, so the agent
 * can say so rather than wait.
 */
export const RequestFolder = setupTool({
  inputSchema: BaseInputSchema.extend({
    reason: z.string().trim().min(1).max(300).meta({
      description:
        "One sentence, addressed to the user, saying which folder you need and what for: 'Your Desktop, to put the test file there.'",
    }),
    folder: z.string().optional().meta({
      description:
        "The folder you need, by its path. The person can allow it as it is or pick another.",
    }),
  }),
  name: "request_folder",
  outputSchema: z.discriminatedUnion("status", [
    z.object({
      path: z.string(),
      status: z.literal("granted"),
    }),
    z.object({
      // Set when the person had already marked the folder Not allowed in
      // Settings, so no card asked them.
      closed: z.boolean().optional(),
      status: z.literal("declined"),
    }),
  ]),
}).create({
  description: `Ask the user for a folder: to change files in one you can only look through, to open one that needs their yes, or, without \`folder\`, one you cannot reach for them to pick. The conversation waits while they answer; the answer names the folder's path. Ask for one folder at a time, the one the work is in, and only when the work cannot proceed without it.`,
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
        ? `The user allowed ${output.path}. You and every task you start reach it.`
        : output.closed
          ? `The user marked that folder Not allowed in Settings › Permissions, so nobody was asked. Say what you skipped without it, link [Permissions](${APP_NAME_SLUG}://settings/permissions) in case they want to change it, and carry on with what you can.`
          : "The user declined. Say what you cannot do without the folder and carry on with what you can.",
  }),
});
