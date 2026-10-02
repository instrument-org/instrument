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
import {
  listInvalidProjectFolders,
  trashInvalidProjectFolder,
} from "../../lib/project";
import { chatsDir } from "../../lib/record-folders";
import { base, toORPCError } from "../base";

const InvalidFolderKindSchema = z.enum(["chat", "project", "task"]);

const InvalidFolderSchema = z.object({
  kind: InvalidFolderKindSchema,
  name: z.string(),
  path: z.string(),
  reason: z.string(),
});

const location = base
  .output(
    z.object({
      projectsDir: z.string(),
      rootDir: z.string(),
      tasksDir: z.string(),
    }),
  )
  .handler(({ context }) => ({
    projectsDir: context.workspaceConfig.projectsDir,
    rootDir: context.workspaceConfig.rootDir,
    tasksDir: context.workspaceConfig.tasksDir,
  }));

// Folders on disk that the app can't open as a chat, task or project (bad
// name, missing/corrupt settings, or an unreadable store). Surfaced so the user can discover and trash them,
// rather than reported as a telemetry exception on every scan.
const listInvalidFolders = base
  .output(InvalidFolderSchema.array())
  .handler(async ({ context }) => {
    const { projectsDir, tasksDir } = context.workspaceConfig;
    const [chats, projects, tasks] = await Promise.all([
      listInvalidChatFolders(),
      listInvalidProjectFolders(),
      listInvalidTaskFolders(context.workspaceConfig),
    ]);
    return [
      ...chats.map((folder) => ({
        kind: "chat" as const,
        ...folder,
        path: absolutePathJoin(chatsDir(), folder.name),
      })),
      ...projects.map((folder) => ({
        kind: "project" as const,
        ...folder,
        path: absolutePathJoin(projectsDir, folder.name),
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
      project: () => trashInvalidProjectFolder(name),
      task: () => trashInvalidTaskFolder(name, context.workspaceConfig),
    }[kind];
    const result = await trash();
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    context.workspaceConfig.captureEvent(`${kind}.invalid_folder_trashed`);
  });

export const storage = {
  invalidFolders: {
    list: listInvalidFolders,
    trash: trashInvalidFolder,
  },
  location,
};
