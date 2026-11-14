import { isEqual } from "radashi";

import {
  groupLayoutModelNote,
  isChatAlone,
} from "../model-text/notes/group-layout-model-text";
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

type Placed = Pick<
  SessionMessagePart.DataPart["metadata"],
  "createdAt" | "messageId" | "sessionId"
>;

/**
 * The layout parts a message on a chat's own session carries: the group it
 * works in, when it reads differently from the last layout the session's
 * log has, and what changed since that one. Nothing for a task's session,
 * for no read (no window answered), and for a first layout that is the chat
 * alone, which has nothing to say. Read from the chat's own records, so
 * earlier parts are never rewritten.
 */
export async function layoutParts({
  chatId,
  read,
  ...placed
}: Placed & {
  chatId: ChatId;
  /** What the window read, at the send or when the wake asked. */
  read: LayoutRead | undefined;
}): Promise<SessionMessagePart.DataPart[]> {
  if (read === undefined || sessionRole(chatId, placed.sessionId) !== "chat") {
    return [];
  }
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
          movedIn: read.movedIn,
          movedOut: read.movedOut,
        });
  return [
    {
      data: now,
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

/**
 * Whether two layouts read the same to the agent: the same group, and the
 * same structure as its note states it, so a page's title changing alone
 * writes nothing.
 */
function sameLayout(one: LayoutSnapshot, other: LayoutSnapshot): boolean {
  return (
    isEqual(one.group, other.group) &&
    groupLayoutModelNote(one) === groupLayoutModelNote(other)
  );
}
