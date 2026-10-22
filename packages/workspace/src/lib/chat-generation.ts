import { type ChatId } from "../schemas/chat-id";
import { type StoreId } from "../schemas/store-id";

/**
 * How many times each chat's records have changed since this process
 * started, counted by the session each change was to. Every change to a
 * chat this process writes, and every change another device's files bring,
 * is counted here, so a count read back unchanged means nothing a reader
 * derived from it then has moved. One task appending to the chat's folder
 * leaves what was derived from the chat's own session, and from every other
 * task, standing.
 */
const BY_SESSION = new Map<string, number>();
/** Changes to the chat itself rather than to one session: every session's. */
const WHOLE_CHAT = new Map<ChatId, number>();

/**
 * Counts a change to a chat: to one session, or to the whole chat where no
 * session is named.
 */
export function bumpChatGeneration(
  id: ChatId,
  sessionId?: StoreId.Session,
): void {
  if (sessionId === undefined) {
    WHOLE_CHAT.set(id, (WHOLE_CHAT.get(id) ?? 0) + 1);
    return;
  }
  const counted = sessionKey(id, sessionId);
  BY_SESSION.set(counted, (BY_SESSION.get(counted) ?? 0) + 1);
}

/**
 * A value derived from one session of a chat, kept until something that
 * session reads changes. The value is computed against the generation it
 * started at, and kept only if no change landed while it was computed and
 * `keepWhen` accepts it.
 */
export function cacheByChatGeneration<Value>(
  keepWhen: (value: Value) => boolean = () => true,
) {
  const entries = new Map<
    string,
    { generation: string; value: Promise<Value> }
  >();
  return (
    chatId: ChatId,
    sessionId: StoreId.Session,
    compute: () => Promise<Value>,
  ): Promise<Value> => {
    const key = sessionKey(chatId, sessionId);
    const generation = chatGeneration(chatId, sessionId);
    const known = entries.get(key);
    if (known?.generation === generation) {
      return known.value;
    }
    const value = compute();
    entries.set(key, { generation, value });
    const forget = () => {
      if (entries.get(key)?.value === value) {
        entries.delete(key);
      }
    };
    void value.then((settled) => {
      if (
        chatGeneration(chatId, sessionId) !== generation ||
        !keepWhen(settled)
      ) {
        forget();
      }
    }, forget);
    return value;
  };
}

function sessionKey(chatId: ChatId, sessionId: StoreId.Session) {
  return `${chatId}\n${sessionId}`;
}

/** A session's change count in its chat, comparable only for equality. */
function chatGeneration(chatId: ChatId, sessionId: StoreId.Session): string {
  return `${WHOLE_CHAT.get(chatId) ?? 0}:${BY_SESSION.get(sessionKey(chatId, sessionId)) ?? 0}`;
}
