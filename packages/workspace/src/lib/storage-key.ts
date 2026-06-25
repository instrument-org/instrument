import { StoreId } from "../schemas/store-id";

export namespace StorageKey {
  const SEPARATOR = ":";
  export const MESSAGES_KEY = "messages";

  // Per-session baseline of the task's attached folders, diffed against the
  // current set when composing a user message to detect folders the user
  // removed between turns. Keyed by session so concurrent chats in the same task
  // each track what they witnessed.
  export function attachedFoldersBaseline(sessionId: StoreId.Session) {
    return ["attached-folders-baseline", sessionId].join(SEPARATOR);
  }

  // Per-session marker and last-known page for managed browser use. Live
  // browser presence remains authoritative for whether a tab is currently open.
  export function browserState(sessionId: StoreId.Session) {
    return ["browser-state", sessionId].join(SEPARATOR);
  }

  export function extractMessageId(messageKey: string): StoreId.Message {
    return StoreId.MessageSchema.parse(messageKey.split(SEPARATOR).at(-1));
  }

  export function extractPartId(partKey: string): StoreId.Part {
    return StoreId.PartSchema.parse(partKey.split(SEPARATOR).at(-1));
  }

  export function extractSessionId(sessionKey: string): StoreId.Session {
    return StoreId.SessionSchema.parse(sessionKey.split(SEPARATOR).at(-1));
  }

  // Per-session baseline of the on-disk file index, diffed against a fresh walk
  // when composing a user message to detect changes made between turns. Keyed by
  // session so concurrent chats in the same task each track what they witnessed.
  export function fileIndexBaseline(sessionId: StoreId.Session) {
    return ["file-index-baseline", sessionId].join(SEPARATOR);
  }

  export function message(
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
  ) {
    return [StorageKey.messages(sessionId), messageId].join(SEPARATOR);
  }

  export function messages(sessionId: StoreId.Session) {
    return [MESSAGES_KEY, sessionId].join(SEPARATOR);
  }

  export function part(
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
    partId: StoreId.Part,
  ) {
    return [StorageKey.parts(sessionId, messageId), partId].join(SEPARATOR);
  }

  export function parts(
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
  ) {
    return ["parts", sessionId, messageId].join(SEPARATOR);
  }

  export function session(sessionId: StoreId.Session) {
    return [StorageKey.sessions(), sessionId].join(SEPARATOR);
  }

  export function sessions() {
    return "sessions";
  }
}
