import { APP_NAME } from "@instrument-org/shared";
import { eventIterator, ORPCError } from "@orpc/server";
import { z } from "zod";

import { folderReach } from "../../../lib/chat/folder-reach";
import { lookInside } from "../../../lib/chat/folder-look";
import { grantFolder, revokeGrant } from "../../../lib/chat/grants";
import { updatePermissionSettings } from "../../../lib/permissions/rules";
import { getCurrentDate } from "../../../lib/get-current-date";
import { AbsolutePathSchema } from "../../../schemas/paths";
import { recordChanges } from "../../../lib/record-changes";
import { effectiveFolderAccess } from "../../../lib/workspace-fs-layout";
import { MountedFolder } from "../../../schemas/mounted-folder";
import { type ChatId, ChatIdSchema } from "../../../schemas/chat-id";
import { base } from "../../base";
import { distinct, liveRead } from "../../live-read";

/**
 * The folders a chat reaches, by the name each is mounted under: more than
 * it holds grants for (folder-reach.ts). Each carries the access its mount
 * gets, so a folder holding the app's own data (the home folder) reads as
 * read-only, the way the agent meets it.
 */
const folders = base
  .input(z.object({ id: ChatIdSchema }))
  .output(z.record(z.string(), MountedFolder.Schema))
  .handler(({ input }) => reachedFolders(input.id));

/**
 * The same folders, read again when the chat's settings move (a grant) or
 * its session row does (a topic it is filed under, whose folders it reaches).
 */
export const liveChatFolders = base
  .input(z.object({ id: ChatIdSchema }))
  .output(eventIterator(z.record(z.string(), MountedFolder.Schema)))
  .handler(async function* ({ input, signal }) {
    yield* distinct(
      liveRead({
        changes: [
          recordChanges(
            signal,
            (change) =>
              change.id === input.id &&
              (change.kind === "settings" || change.kind === "session"),
          ),
        ],
        read: () => reachedFolders(input.id),
      }),
    );
  });

async function reachedFolders(chatId: ChatId) {
  return Object.fromEntries(
    Object.entries(await folderReach(chatId)).map(([name, folder]) => [
      name,
      { ...folder, access: effectiveFolderAccess(folder) },
    ]),
  );
}

/**
 * Grant a chat a folder outside of a message: what answering an agent's
 * request for one does, read and write, in that chat. "Always" also allows
 * the folder in Settings › Permissions, for every chat from then on.
 *
 * The folder is looked inside first, so the system's own ask for a folder it
 * guards comes up beside the card. A folder the system already refused is not
 * granted: only the system's folder panel undoes that, and the card opens it.
 */
const grantFolderRoute = base
  .input(
    z.object({
      always: z.boolean().optional(),
      id: ChatIdSchema,
      path: z.string(),
    }),
  )
  .output(MountedFolder.Schema)
  .handler(async ({ input }) => {
    const look = await lookInside(input.path);
    if (look === "missing") {
      throw new ORPCError("NOT_FOUND", {
        message: `There's no folder at ${input.path}.`,
      });
    }
    if (look === "system") {
      throw new ORPCError("FORBIDDEN", {
        data: { refusedBy: "system" },
        message: `macOS hasn't let ${APP_NAME} into ${input.path}.`,
      });
    }
    const grant = await grantFolder({
      chatId: input.id,
      path: input.path,
      source: "card",
    });
    if (input.always) {
      const path = AbsolutePathSchema.parse(input.path);
      await updatePermissionSettings((settings) => ({
        ...settings,
        folders: [
          ...settings.folders.filter((folder) => folder.path !== path),
          { addedAt: getCurrentDate(), level: "allow", path },
        ],
      }));
    }
    // Named the way the agent reaches it, beside the folders a chat reaches
    // without holding.
    const reached = Object.values(await folderReach(input.id)).find(
      (folder) => folder.path === grant.path,
    );
    if (!reached) {
      throw new Error(`Folder ${grant.path} is granted but not reached`);
    }
    return reached;
  });

/** Takes a folder back from a chat; what the rules say about it still holds. */
const revokeFolderRoute = base
  .input(z.object({ id: ChatIdSchema, path: z.string() }))
  .output(z.void())
  .handler(async ({ input }) => {
    await revokeGrant({ chatId: input.id, path: input.path });
  });

export const chatFolders = {
  get: folders,
  grant: grantFolderRoute,
  revoke: revokeFolderRoute,
};
