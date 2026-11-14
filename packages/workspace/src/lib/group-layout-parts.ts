import { isEqual } from "radashi";

import { isChatAlone } from "../model-text/notes/group-layout-model-text";
import { type ChatId } from "../schemas/chat-id";
import { type LayoutRead, type LayoutSnapshot } from "../schemas/group-layout";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { ChatReads } from "./chat-reads";
import { sessionRole } from "./chat/children";
import { layoutChanges } from "./group-layout";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The latest layout each chat's window read, by chat, kept in memory: the
 * window hands one over as the group a chat works in changes, and with
 * every message it sends. A relaunch starts with none until the window
 * reads again.
 */
const latestReads = new Map<ChatId, LayoutRead>();

/** Keeps what the window read of the group a chat works in, the latest winning. */
export function noteLayoutRead(chatId: ChatId, read: LayoutRead): void {
  latestReads.set(chatId, read);
}

type Placed = Pick<
  SessionMessagePart.DataPart["metadata"],
  "createdAt" | "messageId" | "sessionId"
>;

/**
 * The layout parts a message on a chat's own session carries: the group it
 * works in, when it reads differently from the last layout the session's
 * log has, and what changed since that one. Nothing for a task's session,
 * for a chat the window has read nothing for, and for a first layout that
 * is the chat alone, which has nothing to say. Read from the chat's own
 * records, so earlier parts are never rewritten.
 */
export async function layoutParts({
  chatId,
  read = latestReads.get(chatId),
  ...placed
}: Placed & {
  chatId: ChatId;
  /** What the window read; the latest it handed over when absent. */
  read?: LayoutRead;
}): Promise<SessionMessagePart.DataPart[]> {
  if (read === undefined || sessionRole(chatId, placed.sessionId) !== "chat") {
    return [];
  }
  latestReads.set(chatId, read);
  const history = await ChatReads.history({
    chatId,
    sessionId: placed.sessionId,
  });
  if (history.isErr()) {
    getWorkspaceConfig().captureException(history.error);
    return [];
  }
  const before = lastLayout(history.value);
  const now = read.layout;
  if (before === undefined ? isChatAlone(now) : sameLayout(before, now)) {
    return [];
  }
  const metadata = () => ({ ...placed, id: StoreId.newPartId() });
  const changes =
    before === undefined
      ? []
      : layoutChanges(before, now, {
          after: read.elsewhere,
          ...(before.elsewhere ? { before: before.elsewhere } : {}),
        });
  return [
    {
      data: { ...now, elsewhere: read.elsewhere },
      metadata: metadata(),
      type: "data-groupLayout",
    },
    ...(changes.length === 0
      ? []
      : [
          {
            data: { changes },
            metadata: metadata(),
            type: "data-layoutChanges" as const,
          },
        ]),
  ];
}

/** The last layout a session's log has, newest message first. */
function lastLayout(
  history: readonly SessionMessage.WithParts[],
): SessionMessageDataPart.GroupLayoutDataPart | undefined {
  for (const message of history.toReversed()) {
    const part = message.parts.findLast(
      (each) => each.type === "data-groupLayout",
    );
    if (part?.type === "data-groupLayout") {
      return part.data;
    }
  }
  return undefined;
}

/** Whether two layouts read the same, where the other tabs stood aside. */
function sameLayout(one: LayoutSnapshot, other: LayoutSnapshot): boolean {
  return (
    isEqual(one.group, other.group) &&
    one.focused === other.focused &&
    isEqual(one.sides, other.sides)
  );
}
