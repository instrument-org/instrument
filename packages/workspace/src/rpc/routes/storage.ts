import { z } from "zod";

import { absolutePathJoin } from "../../lib/absolute-path-join";
import {
  listInvalidChatFolders,
  trashInvalidChatFolder,
} from "../../lib/invalid-chat-folders";
import {
  listInvalidTaskFolders,
  trashInvalidTaskFolder,
} from "../../lib/invalid-task-folders";
import { chatsDir } from "../../lib/record-folders";
import { base, toORPCError } from "../base";

/** A chat's folder, a task's inside a chat, or a task's no chat owns. */
const InvalidFolderKindSchema = z.enum(["chat", "chat-task", "task"]);

const InvalidFolderSchema = z.object({
  kind: InvalidFolderKindSchema,
  name: z.string(),
  path: z.string(),
  reason: z.string(),
});

const location = base
  .output(
    z.object({
      rootDir: z.string(),
      tasksDir: z.string(),
    }),
  )
  .handler(({ context }) => ({
    rootDir: context.workspaceConfig.rootDir,
    tasksDir: context.workspaceConfig.tasksDir,
  }));

// Folders on disk that the app can't open as a chat or task (bad
// name, missing/corrupt settings, or an unreadable store). Surfaced so the user can discover and trash them,
// rather than reported as an exception on every scan.
const listInvalidFolders = base
  .output(InvalidFolderSchema.array())
  .handler(async ({ context }) => {
    const { tasksDir } = context.workspaceConfig;
    const [chats, tasks] = await Promise.all([
      listInvalidChatFolders(),
      listInvalidTaskFolders(context.workspaceConfig),
    ]);
    return [
      ...chats.map((folder) => ({
        ...folder,
        path: absolutePathJoin(chatsDir(), folder.name),
      })),
      ...tasks.map((folder) => ({
        kind: "task" as const,
        ...folder,
        path: absolutePathJoin(tasksDir, folder.name),
      })),
    ];
  });

const trashInvalidFolder = base
  .input(z.object({ kind: InvalidFolderKindSchema, name: z.string() }))
  .output(z.void())
  .handler(async ({ context, errors, input: { kind, name } }) => {
    const trash = {
      chat: () => trashInvalidChatFolder(name, context.workspaceConfig),
      "chat-task": () => trashInvalidChatFolder(name, context.workspaceConfig),
      task: () => trashInvalidTaskFolder(name, context.workspaceConfig),
    }[kind];
    const result = await trash();
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
