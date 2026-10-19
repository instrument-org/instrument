import { z } from "zod";

import { resolveWorkspaceFilePaths } from "../../../lib/resolve-workspace-file-path";
import { ChatIdSchema } from "../../../schemas/chat-id";
import { base } from "../../base";

/**
 * Where the files a task named sit on the computer, by the path the task
 * wrote. The person's side of the window works in those paths: a viewer
 * reads the bytes by one, a tab is addressed by one, and the agent's own
 * paths are translated once, here, on their way to the screen. Null for a
 * path outside everything the task can reach, and for one that is no path
 * this computer can read, each on its own.
 */
const hostPaths = base
  .input(
    z.object({
      // Checked one by one as each is resolved, so a path that is not one
      // of ours maps to null rather than refusing the whole surface.
      filePaths: z.array(z.string()),
      chatId: ChatIdSchema,
    }),
  )
  .output(z.record(z.string(), z.string().nullable()))
  .handler(async ({ input: { filePaths, chatId } }) =>
    Object.fromEntries(await resolveWorkspaceFilePaths({ filePaths, chatId })),
  );

export const chatFiles = {
  hostPaths,
};
