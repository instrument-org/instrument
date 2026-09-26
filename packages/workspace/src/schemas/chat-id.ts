import { StoreId } from "./store-id";
import { type TaskId, TaskIdSchema } from "./task-id";

const CHAT_ID_PREFIX = "chat-";
const SESSION_ID_PREFIX = "ses_";

/**
 * A chat's record id, which is also its folder's name, taken from its one
 * session's id: the session id's ULID, lowercased so it is a DNS label, behind
 * `chat-`. Everything that knows a chat by its session (the window's routes,
 * its drafts, its tab groups, a task's report home) finds the record without
 * asking anything.
 */
export function chatIdOf(sessionId: StoreId.Session): TaskId {
  return TaskIdSchema.parse(
    `${CHAT_ID_PREFIX}${sessionId.slice(SESSION_ID_PREFIX.length).toLowerCase()}`,
  );
}

/** Whether an id names a chat's record rather than a task's. */
export function isChatId(id: string): boolean {
  return sessionOfChat(id) !== undefined;
}

/** The session a chat's record holds, or none for an id that is not a chat's. */
export function sessionOfChat(id: string): StoreId.Session | undefined {
  if (!id.startsWith(CHAT_ID_PREFIX)) {
    return undefined;
  }
  const parsed = StoreId.SessionSchema.safeParse(
    `${SESSION_ID_PREFIX}${id.slice(CHAT_ID_PREFIX.length).toUpperCase()}`,
  );
  return parsed.success ? parsed.data : undefined;
}
