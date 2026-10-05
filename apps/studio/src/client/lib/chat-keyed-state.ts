import { type ChatId, StoreId } from "@instrument-org/workspace/client";

/**
 * The window's kept state that named chats by their session, each key with
 * the key its value moved to once chats were named by their own ids. The
 * version in a key is what keeps an old value from being read as a new one.
 */
export const CHAT_KEYED_STATE = [
  ["studio.app-tabs.v1", "studio.app-tabs.v2"],
  ["studio.chat-group.v1", "studio.chat-group.v2"],
  ["studio.compose.v1", "studio.compose.v2"],
  ["studio.drafts.v1", "studio.drafts.v2"],
  ["studio.pane-open.v1", "studio.pane-open.v2"],
  ["studio.recents.v3", "studio.recents.v4"],
  ["studio.window-tabs.v8", "studio.window-tabs.v9"],
] as const;

/** Where in a kept value a session id stands: whole, or inside an address. */
const SESSION_IN_TEXT = /ses_[0-9A-Za-z]{26}/g;

type Storage = Pick<globalThis.Storage, "getItem" | "removeItem" | "setItem">;

/** Whether any state is still kept under a key that named chats by their session. */
export function hasChatKeyedState(storage: Storage): boolean {
  return CHAT_KEYED_STATE.some(([from]) => storage.getItem(from) !== null);
}

/** The sessions the kept state names, chats' and pages' alike. */
export function sessionsInChatKeyedState(storage: Storage): StoreId.Session[] {
  const found = new Set<StoreId.Session>();
  for (const [from] of CHAT_KEYED_STATE) {
    for (const match of storage.getItem(from)?.matchAll(SESSION_IN_TEXT) ??
      []) {
      const session = StoreId.SessionSchema.safeParse(match[0]);
      if (session.success) {
        found.add(session.data);
      }
    }
  }
  return [...found];
}

/**
 * Moves the kept state to the keys that name chats by their ids, once: each
 * chat's session, wherever it stands in a value (a group's key, an address,
 * a window along the foot), becomes the chat's id, and the old key goes. A
 * session that is no chat's (a page's own, a chat since deleted) is left as
 * it was, except a floating chat window, which goes with its chat. A key
 * already written under its new name is left alone.
 */
export function convertChatKeyedState(
  storage: Storage,
  chatOfSession: ReadonlyMap<string, ChatId>,
) {
  for (const [from, to] of CHAT_KEYED_STATE) {
    const raw = storage.getItem(from);
    if (raw === null) {
      continue;
    }
    if (storage.getItem(to) === null) {
      const value: unknown = renamed(parsed(raw), chatOfSession);
      if (value !== undefined) {
        storage.setItem(
          to,
          JSON.stringify(
            to === "studio.compose.v2" ? floatingChats(value) : value,
          ),
        );
      }
    }
    storage.removeItem(from);
  }
}

function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** A kept value with every chat's session in it, in keys and in text, named by the chat's id. */
function renamed(
  value: unknown,
  chatOfSession: ReadonlyMap<string, ChatId>,
): unknown {
  if (typeof value === "string") {
    return value.replaceAll(
      SESSION_IN_TEXT,
      (session) => chatOfSession.get(session) ?? session,
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renamed(entry, chatOfSession));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        renamed(key, chatOfSession),
        renamed(entry, chatOfSession),
      ]),
    );
  }
  return value;
}

/**
 * The windows along the foot with each chat's named by the chat's id under
 * `chatId`, and a chat's whose session named no chat left out: it would be a
 * window onto nothing.
 */
function floatingChats(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.flatMap((entry: unknown) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      !("kind" in entry) ||
      entry.kind !== "chat"
    ) {
      return [entry];
    }
    const { sessionId, ...rest } = { sessionId: undefined, ...entry };
    return typeof sessionId === "string" &&
      !StoreId.SessionSchema.safeParse(sessionId).success
      ? [{ ...rest, chatId: sessionId }]
      : [];
  });
}
