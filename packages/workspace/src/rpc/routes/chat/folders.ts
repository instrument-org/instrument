import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { folderReach } from "../../../lib/chat/folder-reach";
import { grantFolder } from "../../../lib/chat/grants";
import { recordChanges } from "../../../lib/record-changes";
import { effectiveFolderAccess } from "../../../lib/workspace-fs-layout";
import { FolderAttachment } from "../../../schemas/folder-attachment";
import { type ChatId, ChatIdSchema } from "../../../schemas/chat-id";
import { base } from "../../base";
import { distinct, liveRead } from "../../live-read";

/**
 * The folders a chat reaches, by the name each is mounted under: more than
 * it holds grants for (folder-reach.ts). Each carries the access its mount
 * gets, so a folder holding the workspace (the home folder) reads as
 * read-only, the way the agent meets it.
 */
const folders = base
  .input(z.object({ id: ChatIdSchema }))
  .output(z.record(z.string(), FolderAttachment.Schema))
  .handler(({ input }) => reachedFolders(input.id));

/**
 * The same folders, read again when the chat's settings move (a grant) or
 * its session row does (a topic it is filed under, whose folders it reaches).
 */
export const liveChatFolders = base
  .input(z.object({ id: ChatIdSchema }))
  .output(eventIterator(z.record(z.string(), FolderAttachment.Schema)))
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
 * request for one does, read and write, in that chat only. The message path
 * stays the way a folder arrives with something the user typed.
 */
const grantFolderRoute = base
  .input(z.object({ id: ChatIdSchema, path: z.string() }))
  .output(FolderAttachment.Schema)
  .handler(async ({ input }) => {
    const grant = await grantFolder({
      chatId: input.id,
      path: input.path,
      source: "card",
    });
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

export const chatFolders = {
  get: folders,
  grant: grantFolderRoute,
};
