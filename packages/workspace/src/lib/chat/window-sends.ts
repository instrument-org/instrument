import { type ChatId } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { type StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";

/** A message the person sent from a window of this computer in this run of the app. */
interface WindowSend {
  at: number;
  messageId: StoreId.Message;
  /** The window's web contents. */
  window: number;
}

/** The last one of each session. */
const lastSends = new Map<StoreId.Session, WindowSend>();

/**
 * How long a message the person sent counts as just sent. A turn can run for
 * an hour, and by then what their window shows has nothing to do with it.
 */
export const JUST_SENT_MS: number = 10 * 60_000;

/**
 * Remembers that a window sent a message. Kept in memory alone: what a
 * message says of itself is in records another computer, or an earlier run,
 * may have written, and neither is the person at this window now.
 */
export function noteWindowSend(
  sessionId: StoreId.Session,
  send: WindowSend,
): void {
  lastSends.set(sessionId, send);
}

/**
 * The window the person just sent the newest message of a session from.
 * Nothing when the newest message is anything else (a wake, a message from
 * a phone or another computer, one from an earlier run of the app), so a turn
 * something else woke has none.
 */
export async function windowJustSentFrom({
  chatId,
  now = Date.now(),
  sessionId,
}: {
  chatId: ChatId;
  now?: number;
  sessionId: StoreId.Session;
}): Promise<number | undefined> {
  const send = lastSends.get(sessionId);
  if (send === undefined || now - send.at > JUST_SENT_MS) {
    return undefined;
  }
  const history = await ChatReads.history({ chatId, sessionId });
  const newest = history
    .unwrapOr([] as SessionMessage.WithParts[])
    .findLast((message) => message.role === "user");
  return newest?.id === send.messageId ? send.window : undefined;
}
