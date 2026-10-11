import { z } from "zod";

import { absolutePathJoin } from "../../lib/absolute-path-join";
import {
  listInvalidChatFolders,
  trashInvalidChatFolder,
} from "../../lib/invalid-chat-folders";
import {
  listInvalidLegacyTaskFolders,
  trashInvalidLegacyTaskFolder,
} from "../../lib/invalid-legacy-task-folders";
import { chatsDir } from "../../lib/record-folders";
import { base, toORPCError } from "../base";

/** A chat's folder, or a 1.x task's the migration left under `tasks/`. */
const InvalidFolderKindSchema = z.enum(["chat", "legacy-task"]);

const InvalidFolderSchema = z.object({
  kind: InvalidFolderKindSchema,
  name: z.string(),
  path: z.string(),
  reason: z.string(),
});

const location = base
  .output(z.object({ rootDir: z.string() }))
  .handler(({ context }) => ({ rootDir: context.workspaceConfig.rootDir }));

// Folders on disk that the app can't open as a chat (bad name, missing or
// corrupt settings, or an unreadable store), and 1.x task folders the
// migration could not move. Surfaced so the user can discover and trash
// them, rather than reported as a telemetry exception on every scan.
const listInvalidFolders = base
  .output(InvalidFolderSchema.array())
  .handler(async ({ context }) => {
    const { legacyTasksDir } = context.workspaceConfig;
    const [chats, legacyTasks] = await Promise.all([
      listInvalidChatFolders(),
      listInvalidLegacyTaskFolders(context.workspaceConfig),
    ]);
    return [
      ...chats.map((folder) => ({
        kind: "chat" as const,
        ...folder,
        path: absolutePathJoin(chatsDir(), folder.name),
      })),
      ...legacyTasks.map((folder) => ({
        kind: "legacy-task" as const,
        ...folder,
        path: absolutePathJoin(legacyTasksDir, folder.name),
      })),
    ];
  });

const trashInvalidFolder = base
  .input(z.object({ kind: InvalidFolderKindSchema, name: z.string() }))
  .output(z.void())
  .handler(async ({ context, errors, input: { kind, name } }) => {
    const result = await (kind === "chat"
      ? trashInvalidChatFolder(name, context.workspaceConfig)
      : trashInvalidLegacyTaskFolder(name, context.workspaceConfig));
    if (result.isErr()) {
      throw toORPCError(result.error, errors);
    }
    context.workspaceConfig.captureEvent(
      `${kind === "chat" ? "chat" : "task"}.invalid_folder_trashed`,
    );
  });

export const storage = {
  invalidFolders: {
    list: listInvalidFolders,
    trash: trashInvalidFolder,
  },
  location,
};
