import { UNTITLED_CHAT_TITLE } from "../../constants";
import { type Session } from "../../schemas/session";
import { type FoldedSession } from "./fold";

/**
 * A folded session in the shape its callers have always read a session in.
 * The marks say what the person did and when, so each `*At` is when its mark
 * was made; a stop holds until a message that starts a turn comes after it;
 * the title is the newest title mark, else the one the session was started
 * with.
 */
export function sessionOf(session: FoldedSession): Session.Type {
  const { marks, rollover, stopped } = session;
  const title = marks.title;
  const unread = marks.unread;
  const turnSinceStop =
    stopped !== undefined &&
    session.messages.some(
      (message) =>
        message.role === "user" && message.metadata.createdAt > stopped.at,
    );
  return {
    ...(marks.archived?.value && { archivedAt: marks.archived.at }),
    createdAt: session.createdAt,
    ...(session.forkedAt !== undefined && {
      forkedAtMessageId: session.forkedAt,
    }),
    ...(session.handle !== undefined && { handle: session.handle }),
    id: session.id,
    ...(session.parent !== undefined && { parentId: session.parent }),
    ...(rollover && {
      rolledOverAfterMessageId: rollover.after,
      ...(rollover.usableTokens !== undefined && {
        rolledOverUnderUsableTokens: rollover.usableTokens,
      }),
    }),
    ...(marks.starred?.value && { starredAt: marks.starred.at }),
    ...(stopped && !turnSinceStop && { stoppedBy: stopped.by }),
    ...(marks.stoppedAt && { stoppedAt: marks.stoppedAt.value }),
    title: title?.value.text ?? session.title ?? UNTITLED_CHAT_TITLE,
    ...(title?.value.settled && { titleSettledAt: title.at }),
    ...(marks.topics && { topics: marks.topics.value }),
    ...(unread?.value && {
      unreadAt: unread.at,
      ...(unread.value.byUser && { unreadByUser: true }),
    }),
    updatedAt: session.updatedAt,
  };
}
