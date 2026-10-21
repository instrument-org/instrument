import { ok, safeTry } from "neverthrow";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { type ToldFolders } from "../schemas/told";
import { ChatReads } from "./chat-reads";
import { chatGrants } from "./chat/grants";
import { folderReach } from "./chat/folder-reach";
import { baselineRecorded, partsAfter } from "./last-told";
import { shellPath } from "./shell-path";

/**
 * The granted folders the session's model was last told it reaches: what its
 * baseline listed, with each folder note since laid over it. Undefined where
 * the session has no baseline that recorded them.
 */
function lastToldFolders(
  messages: SessionMessage.WithParts[],
  sessionId: StoreId.Session,
): ToldFolders | undefined {
  const recorded = baselineRecorded(messages, sessionId, "folders");
  if (recorded === undefined) {
    return undefined;
  }
  return partsAfter(
    messages,
    ["data-folderChanges"],
    recorded.writtenAt,
  ).reduce<ToldFolders>((told, note) => {
    const removed = new Set(note.data.removed.map(({ path }) => path));
    const kept = told.filter(({ path }) => !removed.has(path));
    const known = new Set(kept.map(({ path }) => path));
    return [
      ...kept,
      ...note.data.added
        .filter(({ path }) => !known.has(path))
        .map(({ path }) => ({ path })),
    ];
  }, recorded.value);
}

/**
 * The folders granted in the chat, as its agent reaches them: what a
 * baseline records it told, and what a later message is measured by.
 */
export async function grantedFolders(chatId: ChatId): Promise<ToldFolders> {
  const grants = await chatGrants(chatId);
  const granted = new Set<string>(grants.map((grant) => grant.path));
  return Object.values(await folderReach(chatId, grants))
    .filter((folder) => granted.has(folder.path))
    .map((folder) => ({ path: folder.path }));
}

/**
 * Diffs the folders granted in the chat, as the agent reaches them, against
 * what the session was last told (`lastToldFolders`) to find folders granted
 * or taken back since. The standing folder list lives in the session
 * context, which is written once, so this is what tells the session the same
 * turn. Returns a `data-folderChanges` part to attach to the user message,
 * which is itself the record of the telling, or undefined when there is no
 * baseline yet or nothing changed. An idle session only learns about changes
 * once it next gets a message.
 *
 * Must run after any grant for this message, so a folder sent with it is told
 * here the same turn instead of lagging behind.
 */
export function detectFolderChanges({
  messageId,
  sessionId,
  chatId,
}: {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  chatId: ChatId;
}) {
  return safeTry<SessionMessagePart.Type | undefined, Error>(
    async function* () {
      const told = lastToldFolders(
        yield* ChatReads.history({ chatId, sessionId }),
        sessionId,
      );
      if (!told) {
        return ok(undefined);
      }
      const current = await grantedFolders(chatId);

      const currentPaths = new Set(current.map((folder) => folder.path));
      const toldPaths = new Set(told.map((folder) => folder.path));
      // A folder granted since: sent with a message, allowed from a card, or
      // added with `task folder --add`. The mount is already live -- the
      // sandbox is built from the chat's grants every turn -- so what this
      // carries is the telling, without which the model has a folder it was
      // never told it had and a standing list that contradicts it.
      const added = current.filter((folder) => !toldPaths.has(folder.path));
      const removed = told.filter((folder) => !currentPaths.has(folder.path));
      if (added.length === 0 && removed.length === 0) {
        return ok(undefined);
      }

      // Spelled now, as the shell spells them on this computer, so the note
      // reads the same wherever the chat is read later.
      const spelled = (folders: ToldFolders) =>
        folders.map(({ path }) => ({ agentPath: shellPath(path), path }));
      return ok({
        data: { added: spelled(added), removed: spelled(removed) },
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
