import { UNTITLED_CHAT_TITLE } from "../../constants";
import { type Session } from "../../schemas/session";
import { type StoreId } from "../../schemas/store-id";
import { type FoldedSession } from "./fold";

/**
 * A folded session in the shape its callers have always read a session in.
 * The settings say what was set and when, so each `*At` is when its setting
 * was made; a stop holds until a message that starts a turn comes after it;
 * the title is the newest title setting, else the one it reads as started
 * with.
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
      ...(rollover.windows !== undefined && {
        rolloverWindows: rollover.windows,
      }),
    }),
    ...(settings.starred?.value && { starredAt: settings.starred.at }),
    ...(stopped && !turnSinceStop && { stoppedBy: stopped.by }),
    title: title?.value.text ?? startedTitle(session),
    // The app's name is still the app's once it settles it, and a rename
    // the user typed never matches a line the app wrote.
    ...(title &&
      (title.value.auto || title.value.text === session.appTitle) && {
        titleByApp: true,
      }),
    ...(title && !title.value.auto && { titleSettledAt: title.at }),
    ...(settings.topic?.value && { topic: settings.topic.value }),
    ...(unread?.value && {
      unreadAt: unread.at,
      ...(unread.value === "marked" && { unreadByUser: true }),
    }),
    updatedAt: session.updatedAt,
  };
}

/**
 * The title a session reads as before any setting names it. A task's is the
 * one it was started with. A chat's own session is started as its opening
 * ask's first words, for a device that has its log and not yet the settings
 * naming it; here it reads as untitled, so the app still names it and
 * `shownTitle` shows those same words meanwhile.
 */
export function startedTitle(start: {
  parent?: StoreId.Session | undefined;
  startedAs?: string | undefined;
}): string {
  return (
    (start.parent === undefined ? undefined : start.startedAs) ??
    UNTITLED_CHAT_TITLE
  );
}
