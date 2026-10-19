import { UNTITLED_CHAT_TITLE } from "../../constants";
import { type Session } from "../../schemas/session";
import { type FoldedSession } from "./fold";

/**
 * A folded session in the shape its callers have always read a session in.
 * The settings say what was set and when, so each `*At` is when its setting
 * was made; a stop holds until a message that starts a turn comes after it;
 * the title is the newest title setting, else the one the session was
 * started with.
 */
export function sessionOf(session: FoldedSession): Session.Type {
  const { rollover, settings, stopped } = session;
  const title = settings.title;
  const unread = settings.unread;
  const turnSinceStop =
    stopped !== undefined &&
    session.messages.some(
      (message) =>
        message.role === "user" && message.metadata.createdAt > stopped.at,
    );
  return {
    ...(settings.archived?.value && { archivedAt: settings.archived.at }),
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
    ...(settings.starred?.value && { starredAt: settings.starred.at }),
    ...(stopped && !turnSinceStop && { stoppedBy: stopped.by }),
    ...(settings.stoppedAt && { stoppedAt: settings.stoppedAt.value }),
    title: title?.value.text ?? session.title ?? UNTITLED_CHAT_TITLE,
    ...(title && !title.value.auto && { titleSettledAt: title.at }),
    ...(settings.topic?.value && { topic: settings.topic.value }),
    ...(unread?.value && {
      unreadAt: unread.at,
      ...(unread.value === "marked" && { unreadByUser: true }),
    }),
    updatedAt: session.updatedAt,
  };
}
