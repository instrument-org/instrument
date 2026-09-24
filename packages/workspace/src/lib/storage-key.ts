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

  // Per-session record of the background processes the agent was last told
  // about. The registry itself is in memory, so this is the only thing that
  // survives a restart to say what the session believes is running -- which is
  // what makes "the server you started is gone" sayable at all.
  export function backgroundProcessesReported(sessionId: StoreId.Session) {
    return ["background-processes-reported", sessionId].join(SEPARATOR);
  }

  // Per-session latch for whether reaching a page has already taken the pane
  // during the turn now running. Lowered as each user message is composed, so a
  // turn takes the pane at most once however many pages it visits.
  export function browserRevealedThisTurn(sessionId: StoreId.Session) {
    return ["browser-revealed-this-turn", sessionId].join(SEPARATOR);
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

  export function message(
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
  ) {
    return [StorageKey.messages(sessionId), messageId].join(SEPARATOR);
  }

  export function messages(sessionId: StoreId.Session) {
    return [MESSAGES_KEY, sessionId].join(SEPARATOR);
  }

  // Per-session record of the pane tabs the agent was last told about, so a
  // turn only carries the list when it has changed. Keyed by session because
  // what a given conversation has been told is a fact about that conversation.
  export function paneTabsReported(sessionId: StoreId.Session) {
    return ["pane-tabs-reported", sessionId].join(SEPARATOR);
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
