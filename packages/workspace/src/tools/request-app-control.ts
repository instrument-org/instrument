import { APP_NAME, APP_NAME_SLUG } from "@instrument-org/shared";
import ms from "ms";
import { z } from "zod";

import { executeError } from "../lib/execute-error";
import { BaseInputSchema } from "./base";
import { setupTool } from "./create-tool";

/**
 * Ask the user to let the agent control an app on this computer.
 *
 * Interactive, like `request_folder`: the call parks the turn and the chat
 * shows a card offering to allow the app in this chat or always. An app the
 * person marked Not allowed gets no card; the call answers declined and
 * closed.
 */
export const RequestAppControl = setupTool({
  inputSchema: BaseInputSchema.extend({
    app: z.string().trim().min(1).max(100).meta({
      description:
        'The app, by the name your script tells it by: "Mail", "Notes", "Music".',
    }),
    reason: z.string().trim().min(1).max(300).meta({
      description:
        "One sentence, addressed to the user, saying what you need the app for: 'Mail, to draft the reply to Dana.'",
    }),
  }),
  name: "request_app_control",
  outputSchema: z.discriminatedUnion("status", [
    z.object({ status: z.literal("granted") }),
    z.object({
      // Set when the person had already marked the app Not allowed in
      // Settings, so no card asked them.
      closed: z.boolean().optional(),
      status: z.literal("declined"),
    }),
  ]),
}).create({
  description: `Ask the user to let you control an app on this computer with \`osascript\`. Every app needs their yes once, in this chat or always; \`osascript\` says when one does. Ask for one app at a time, and only when the work needs it. Finder, System Events and Terminal reach every file, so ask for those only when nothing narrower will do.`,
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
  toModelOutput: ({ input, output }) => ({
    type: "text",
    value:
      output.status === "granted"
        ? `The user let you control ${input.app}. Run the script again.`
        : output.closed
          ? `The user marked ${input.app} Not allowed in Settings › Permissions, so nobody was asked. Say what you skipped without it, link [Permissions](${APP_NAME_SLUG}://settings/permissions) in case they want to change it, and carry on with what you can.`
          : `The user said not now. Say what you cannot do without ${input.app} and carry on with what you can; ${APP_NAME} will not control it.`,
  }),
});
