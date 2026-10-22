import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { folderReach } from "../../../lib/chat/folder-reach";
import { recordChanges } from "../../../lib/record-changes";
import {
  chatDir,
  chatOwnFolder,
  resolveChat,
} from "../../../lib/record-folders";
import { effectiveFolderAccess } from "../../../lib/workspace-fs-layout";
import { MountedFolder } from "../../../schemas/mounted-folder";
import { type ChatId, ChatIdSchema } from "../../../schemas/chat-id";
import { base } from "../../base";
import { distinct, liveRead, where } from "../../live-read";
import { publisher } from "../../publisher";

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

/**
 * Where the chat's own folder under `Chats/` is, null for a chat with none,
 * read again each time it moves to the chat's title. A surface that shows
 * the chat's files asks for their places again when it changes.
 */
export const liveChatOwnFolder = base
  .input(z.object({ id: ChatIdSchema }))
  .output(eventIterator(z.string().nullable()))
  .handler(async function* ({ input, signal }) {
    yield* distinct(
      liveRead({
        changes: [
          where(
            publisher.subscribe("chat.folderMoved", { signal }),
            (moved) => moved.id === input.id,
          ),
        ],
        // The window is no chat and has no folder.
        read: () =>
          resolveChat(input.id) === undefined
            ? null
            : (chatOwnFolder(chatDir(input.id)) ?? null),
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
