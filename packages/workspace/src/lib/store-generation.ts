import { type ChatId } from "../schemas/chat-id";
import { type StoreId } from "../schemas/store-id";
import { StorageKey } from "./storage-key";

/**
 * How many times each chat's store has been written since this process
 * started, counted by the session each write was to. Every write goes through
 * this process's storage, so a value read back unchanged means nothing it
 * counts has changed since: what a reader derived from it then is still true.
 * One task streaming into the chat's store leaves what was derived from the
 * chat's own session, and from every other task, standing.
 */
const BY_SESSION = new Map<string, number>();
/** Writes to a key that names no session, and the store closing: every session's. */
const WHOLE_CHAT = new Map<ChatId, number>();
let epoch = 0;

/** Every chat's store changed at once: a test clearing the storage it shares. */
export function bumpEveryStoreGeneration() {
  epoch += 1;
}

/**
 * Counts a write to a chat's store: to the session `key` names, or to the
 * whole chat for a key that names none, or none given.
 */
export function bumpStoreGeneration(id: ChatId, key?: string) {
  const sessionId = key === undefined ? undefined : StorageKey.sessionOf(key);
  if (sessionId === undefined) {
    WHOLE_CHAT.set(id, (WHOLE_CHAT.get(id) ?? 0) + 1);
    return;
  }
  const counted = sessionKey(id, sessionId);
  BY_SESSION.set(counted, (BY_SESSION.get(counted) ?? 0) + 1);
}

/**
 * A value derived from one session in a chat's store, kept until something
 * that session reads is written. The value is computed against the
 * generation it started at, and kept only if no write landed while it was
 * computed and `keepWhen` accepts it.
 */
export function cacheByStoreGeneration<Value>(
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
    const generation = storeGeneration(chatId, sessionId);
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
        storeGeneration(chatId, sessionId) !== generation ||
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

/** A session's write count in its chat's store, comparable only for equality. */
function storeGeneration(chatId: ChatId, sessionId: StoreId.Session): string {
  return `${epoch}:${WHOLE_CHAT.get(chatId) ?? 0}:${BY_SESSION.get(sessionKey(chatId, sessionId)) ?? 0}`;
}
