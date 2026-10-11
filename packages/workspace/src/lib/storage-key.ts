import { StoreId } from "../schemas/store-id";

export namespace StorageKey {
  const SEPARATOR = ":";
  export const MESSAGES_KEY = "messages";

  // Per-session baseline of the folders granted in the chat, diffed against
  // the current set when composing a user message to tell the session of
  // folders granted, taken back, or moved to a new mount since. Keyed by
  // session so the chat and each of its tasks track what they were told.
  export function foldersBaseline(sessionId: StoreId.Session) {
    return ["folders-baseline", sessionId].join(SEPARATOR);
  }

  // Per-session record of the background processes the agent was last told
  // about. The registry itself is in memory, so this is the only thing that
  // survives a restart to say what the session believes is running -- which is
  // what makes "the server you started is gone" sayable at all.
  export function backgroundProcessesReported(sessionId: StoreId.Session) {
    return ["background-processes-reported", sessionId].join(SEPARATOR);
  }

  // Per-session marker and last-known page for managed browser use. Live
  // browser presence remains authoritative for whether a tab is currently open.
  export function browserState(sessionId: StoreId.Session) {
    return ["browser-state", sessionId].join(SEPARATOR);
  }

  export function extractMessageId(messageKey: string): StoreId.Message {
    return StoreId.MessageSchema.parse(messageKey.split(SEPARATOR).at(-1));
  }

  // The session segment of a message key, for a listing that spans sessions.
  export function extractMessageSessionId(messageKey: string): StoreId.Session {
    return StoreId.SessionSchema.parse(messageKey.split(SEPARATOR).at(1));
  }

  export function extractPartId(partKey: string): StoreId.Part {
    return StoreId.PartSchema.parse(partKey.split(SEPARATOR).at(-1));
  }

  export function extractSessionId(sessionKey: string): StoreId.Session {
    return StoreId.SessionSchema.parse(sessionKey.split(SEPARATOR).at(-1));
  }

  // The revision of memory a session was last told, so a turn only carries the
  // list when something changed since. Keyed by session because what a given
  // conversation has been told is a fact about that conversation.
  export function memoryReported(sessionId: StoreId.Session) {
    return ["memory-reported", sessionId].join(SEPARATOR);
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

  // Per-session record of the workspace's apps and whether each was connected,
  // as a chat's agent last heard: diffed when the user next writes, so a
  // disconnect or a removal made outside the conversation reaches it then,
  // never by waking the chat.
  export function chatAppsBaseline(sessionId: StoreId.Session) {
    return ["chat-apps-baseline", sessionId].join(SEPARATOR);
  }
}
