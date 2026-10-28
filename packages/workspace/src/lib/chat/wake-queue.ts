import { type ChatId } from "../../schemas/chat-id";
import { recordChanged } from "../record-changes";

/** Something of a chat's counted toward a wake being on its way. */
interface OnItsWay {
  /** Whether it still has news to start a turn with; counted as long as it has none to ask. */
  stillNews?: () => boolean;
}

/** What each chat has counted toward a wake on its way. */
const onItsWay = new Map<ChatId, Set<OnItsWay>>();

/**
 * Whether a wake is on its way to start a turn in one of the chat's
 * sessions: waiting out a debounce with news still to tell, or between that
 * and reaching its session, which writes its note first and may then spend
 * a while finding the chat's model. The chat is still at work all that
 * time: something of it has moved, and its agent has not started on the
 * news yet.
 */
export function hasWakeOnItsWay(chatId: ChatId): boolean {
  for (const entry of onItsWay.get(chatId) ?? []) {
    if (entry.stillNews?.() ?? true) {
      return true;
    }
  }
  return false;
}

/**
 * Counts something toward the chat's wake being on its way until the
 * returned release is called, which is safe to call twice. The chat's row
 * is read again whenever that moves whether a wake is on its way: a wake
 * that never reached its session leaves the chat as it was, which nothing
 * else would say.
 */
export function countOnItsWay(
  chatId: ChatId,
  entry: OnItsWay = {},
): () => void {
  const before = hasWakeOnItsWay(chatId);
  const entries = onItsWay.get(chatId) ?? new Set();
  entries.add(entry);
  onItsWay.set(chatId, entries);
  if (!before && hasWakeOnItsWay(chatId)) {
    recordChanged(chatId, "agent");
  }
  return () => {
    const was = hasWakeOnItsWay(chatId);
    if (!entries.delete(entry)) {
      return;
    }
    if (entries.size === 0 && onItsWay.get(chatId) === entries) {
      onItsWay.delete(chatId);
    }
    if (was && !hasWakeOnItsWay(chatId)) {
      recordChanged(chatId, "agent");
    }
  };
}
