import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { type ChatRead } from "./chat-records";
import { type FoldedSession } from "./fold";

/**
 * A chat read with one of its sessions put another way: an earlier version of
 * it, or everything an edit took out beside what stands.
 */

function withMessages(
  read: ChatRead,
  sessionId: StoreId.Session,
  change: (session: FoldedSession) => SessionMessage.WithParts[],
): ChatRead {
  return {
    ...read,
    chat: {
      ...read.chat,
      sessions: read.chat.sessions.map((session) =>
        session.id === sessionId
          ? { ...session, messages: change(session) }
          : session,
      ),
    },
  };
}

/**
 * The session as it was when `edited` was edited: what stood before that
 * message, then it and all that followed it. Nothing for a message nobody
 * edited.
 */
export function asEarlierVersion(
  read: ChatRead,
  sessionId: StoreId.Session,
  edited: StoreId.Message,
): ChatRead | undefined {
  const taken = read.chat.sessions
    .find(({ id }) => id === sessionId)
    ?.earlierVersions.get(edited);
  if (taken === undefined) {
    return undefined;
  }
  return {
    ...withMessages(read, sessionId, ({ messages }) => [
      ...messages.filter(
        ({ id, role }) => id < edited && role !== "session-context",
      ),
      ...taken,
    ]),
    // The running turn is the current version's.
    live: new Map(),
  };
}

/** The session with every earlier version's messages beside its own, for a reader that names the ones it wants. */
export function withEarlierVersions(
  read: ChatRead,
  sessionId: StoreId.Session,
): ChatRead {
  return withMessages(read, sessionId, ({ earlierVersions, messages }) => [
    ...new Map(
      [...[...earlierVersions.values()].flat(), ...messages].map((message) => [
        message.id,
        message,
      ]),
    ).values(),
  ]);
}
