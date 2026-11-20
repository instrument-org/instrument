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

type Placed = Pick<
  SessionMessagePart.DataPart["metadata"],
  "createdAt" | "messageId" | "sessionId"
>;

/**
 * The layout parts a message on a chat's own session carries: the group it
 * works in, when it differs from the last layout the session's log has
 * (`sameLayout`), and what changed since that one. Nothing for a task's session,
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
 * Whether two layouts are the same to the agent: the same group, shown or
 * not, and the same tabs on the same sides in the same order, each at the
 * same address and showing or not. A title changing alone, or the keyboard
 * moving between sides, writes nothing.
 */
function sameLayout(one: LayoutSnapshot, other: LayoutSnapshot): boolean {
  return isEqual(shapeOf(one), shapeOf(other));
}

function shapeOf({ group, isShown, sides }: LayoutSnapshot) {
  return {
    group: group.id,
    isShown: isShown ?? true,
    sides: sides.map(({ tabs }) =>
      tabs.map((tab) => [
        tab.isThisChat === true ? "you" : tab.id,
        tab.isThisChat === true ? "" : tab.address,
        // The chat's own tab is a new chat until its first message lands.
        tab.isThisChat === true ? "" : tab.kind,
        tab.isUp === true,
      ]),
    ),
  };
}
