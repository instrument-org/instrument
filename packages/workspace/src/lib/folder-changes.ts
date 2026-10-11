import { ok, safeTry } from "neverthrow";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { getFoldersBaseline, setFoldersBaseline } from "./folders-baseline";
import { chatGrants } from "./chat/grants";
import { folderReach } from "./chat/folder-reach";
import { effectiveFolderAccess } from "./workspace-fs-layout";

/**
 * Diffs the folders granted in the chat, as the agent reaches them, against
 * the session's baseline to find folders granted, taken back, or moved to a
 * new mount since it was last set, then advances the baseline to the current
 * set. The standing folder list lives in the session context, which is
 * rebuilt at most hourly, so this is what tells the session the same turn.
 * Returns a `data-folderChanges` part to attach to the user message, or
 * undefined when there is no baseline yet or nothing changed. Keyed by
 * session so an idle session only learns about changes once it next gets a
 * message.
 *
 * Must run after any grant for this message, so a folder sent with it is told
 * here the same turn instead of lagging behind.
 */
export function detectFolderChanges({
  messageId,
  sessionId,
  signal,
  chatId,
}: {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  chatId: ChatId;
}) {
  return safeTry<SessionMessagePart.Type | undefined, Error>(
    async function* () {
      const grants = await chatGrants(chatId);
      const granted = new Set<string>(grants.map((grant) => grant.path));
      const current = Object.values(await folderReach(chatId, grants))
        .filter((folder) => granted.has(folder.path))
        .map((folder) => ({
          // The access the mount gets, so a granted folder holding the
          // workspace is never announced as writable while the filesystem
          // refuses the writes.
          access: effectiveFolderAccess(folder),
          name: folder.mountName,
          path: folder.path,
        }));

      const baseline = yield* getFoldersBaseline(chatId, sessionId, {
        signal,
      });

      // Re-baseline regardless of the outcome so the next message diffs against
      // the set as it stands now.
      yield* setFoldersBaseline(
        chatId,
        sessionId,
        current.map(({ name, path }) => ({ name, path })),
        { signal },
      );

      if (!baseline) {
        return ok(undefined);
      }

      const currentByPath = new Map<string, (typeof current)[number]>(
        current.map((folder) => [folder.path, folder]),
      );
      const baselinePaths = new Set(baseline.map((folder) => folder.path));
      // A folder granted since: sent with a message, allowed from a card, or
      // added with `task folder --add`. The mount is already live -- the
      // sandbox is built from the chat's grants every turn -- so what this
      // carries is the telling, without which the model has a folder it was
      // never told it had and a standing list that contradicts it.
      const added = current.filter((folder) => !baselinePaths.has(folder.path));
      const removed = baseline.filter(
        (folder) => !currentByPath.has(folder.path),
      );
      // A grant taken back frees its name, so a later grant that was
      // qualified around it mounts under the plain name instead.
      const renamed = baseline.flatMap((folder) => {
        const currentFolder = currentByPath.get(folder.path);
        if (currentFolder === undefined || currentFolder.name === folder.name) {
          return [];
        }
        return [
          {
            newName: currentFolder.name,
            oldName: folder.name,
            path: folder.path,
          },
        ];
      });
      if (added.length === 0 && removed.length === 0 && renamed.length === 0) {
        return ok(undefined);
      }

      return ok({
        data: { added, removed, renamed },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-folderChanges",
      } satisfies SessionMessagePart.Type);
    },
  );
}
