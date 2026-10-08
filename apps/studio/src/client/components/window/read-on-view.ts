/**
 * How long a chat has to stay on screen after arriving at it before it
 * counts as read, so leafing past it (arrowing down the list, opening one
 * and moving on) leaves it unread.
 */
export const READ_DWELL_MS = 500;

/** What the decision reads about the chat on screen and how the user got to it. */
interface ReadView {
  /** The chat on screen now. */
  chatId: string;
  /** Whether it is the chat up in its tab, in a window that is on screen. */
  isUp: boolean;
  /** Whether it carries the unread mark. */
  isUnread: boolean;
  /** Whether the user set that mark themselves. */
  isUnreadByUser: boolean;
  /** The chat and whether it was up on the previous look, both null before the first. */
  previousChatId: null | string;
  wasUp: boolean | null;
}

/**
 * Whether the chat on screen should be marked read, and after how long:
 * null leaves it. Arriving at a chat (bringing it up, or another chat
 * taking the same screen) waits out the dwell; a mark that lands while the
 * user is already on the chat, as it settles under their eyes, goes at
 * once. A mark the user set themselves holds while they stay, and goes
 * only once they come back.
 */
export function readDelay({
  chatId,
  isUnread,
  isUnreadByUser,
  isUp,
  previousChatId,
  wasUp,
}: ReadView): null | number {
  if (!isUnread || !isUp) {
    return null;
  }
  // The same screen shows the next chat without coming down, so the chat
  // changing is an arrival as much as coming up is.
  const hasArrived = wasUp !== true || previousChatId !== chatId;
  if (isUnreadByUser && !hasArrived) {
    return null;
  }
  return hasArrived ? READ_DWELL_MS : 0;
}
