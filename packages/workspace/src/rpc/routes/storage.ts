import { z } from "zod";

import { absolutePathJoin } from "../../lib/absolute-path-join";
import { outputFolderPath } from "../../lib/chat/output-folder";
import {
  listInvalidChatFolders,
  trashInvalidChatFolder,
} from "../../lib/invalid-chat-folders";
import { chatsDir } from "../../lib/record-folders";
import { base, toORPCError } from "../base";

const InvalidFolderSchema = z.object({
  name: z.string(),
  path: z.string(),
  reason: z.string(),
});

/**
 * Where the workspace is kept, and where finished work goes when nobody said
 * where (`outputFolderPath`), which is the workspace's own folder once the
 * person picked one.
 */
const location = base
  .output(z.object({ outputFolder: z.string(), rootDir: z.string() }))
  .handler(({ context }) => ({
    outputFolder: outputFolderPath(),
    rootDir: context.workspaceConfig.rootDir,
  }));

// Folders under chats/ that the app can't open as a chat (bad name, missing or
// corrupt settings, or unreadable records). Surfaced so the user can discover
// and trash them, rather than reported as an exception on every scan.
const listInvalidFolders = base
  .output(InvalidFolderSchema.array())
  .handler(async () =>
    (await listInvalidChatFolders()).map((folder) => ({
      ...folder,
      path: absolutePathJoin(chatsDir(), folder.name),
    })),
  );

const trashInvalidFolder = base
  .input(z.object({ name: z.string() }))
  .output(z.void())
  .handler(async ({ context, errors, input: { name } }) => {
    const result = await trashInvalidChatFolder(name, context.workspaceConfig);
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
  });

export const storage = {
  invalidFolders: {
    list: listInvalidFolders,
    trash: trashInvalidFolder,
  },
  location,
};
