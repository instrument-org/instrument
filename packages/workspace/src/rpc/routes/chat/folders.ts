import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { folderReach } from "../../../lib/chat/folder-reach";
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
 * read-only, the way the agent meets it. Read again when the chat's settings
 * move (a grant) or its session row does (a topic it is filed under, whose
 * folders it reaches).
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
