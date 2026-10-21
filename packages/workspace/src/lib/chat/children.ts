import { z } from "zod";

import { StopperSchema } from "../../schemas/stop-notice";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type Session } from "../../schemas/session";
import { StoreId } from "../../schemas/store-id";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import { createWriteQueue } from "../create-write-queue";
import { resolveChat, sessionOfChat } from "../record-folders";

/**
 * A task: a session in its chat's store, started from the chat's own
 * conversation and carrying it on in the background. Its id is its session's.
 */
export const ChatTaskSchema = z.object({
  chatId: ChatIdSchema,
  createdAt: z.date(),
  /** Its short name in the chat, `t1`, `t2`, …, which the `task` command takes. */
  handle: z.string(),
  id: StoreId.SessionSchema,
  /** Who stopped its last turn, when a stop ended it. */
  stoppedBy: StopperSchema.optional(),
  title: z.string(),
  updatedAt: z.date(),
});

export type ChatTask = z.output<typeof ChatTaskSchema>;

/** One queue per task, for the writes to its session. */
const taskWrites = createWriteQueue();

/** One queue per chat, so two tasks started together get handles of their own. */
const taskStarts = createWriteQueue();

/**
 * Starts a task in its chat's store: a session whose parent is the
 * chat's own, under the next handle the chat has not given, `t1` for its
 * first. Returns it.
 */
export function addChildTask(
  chatId: ChatId,
  fields: Omit<Session.Type, "handle" | "parentId">,
): Promise<ChatTask> {
  return taskStarts(chatId, async () => {
    const parentId = sessionOfChat(chatId);
    if (!parentId) {
      throw new Error(`${chatId} is not a chat.`);
    }
    const given = (await listChildTasks(chatId)).flatMap((task) => {
      const number = /^t(\d+)$/.exec(task.handle)?.[1];
      return number === undefined ? [] : [Number(number)];
    });
    const session = {
      ...fields,
      handle: `t${Math.max(0, ...given) + 1}`,
      parentId,
    };
    const saved = await ChatWrites.saveSession(session, chatId);
    if (saved.isErr()) {
      throw saved.error;
    }
    return taskOf(chatId, saved.value);
  });
}

/**
 * The tasks a chat started, newest activity first, each kept only when
 * `which` takes its id. Anything that is not a chat has none.
 */
export async function listChildTasks(
  chatId: ChatId,
  which: (id: StoreId.Session) => boolean = () => true,
): Promise<ChatTask[]> {
  const chatSession = sessionOfChat(chatId);
  if (!chatSession) {
    return [];
  }
  const sessions = await ChatReads.sessions({
    chatId,
    includeChildSessions: true,
  });
  if (sessions.isErr()) {
    return [];
  }
  return sessions.value
    .filter((session) => session.parentId === chatSession && which(session.id))
    .map((session) => taskOf(chatId, session))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/** One of a chat's tasks by its session, or none when it is not one. */
export async function childTask(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<ChatTask | undefined> {
  const chatSession = sessionOfChat(chatId);
  const session = await ChatReads.session({ chatId, sessionId });
  return chatSession && session.isOk() && session.value.parentId === chatSession
    ? taskOf(chatId, session.value)
    : undefined;
}

/**
 * What a session is in its chat: the chat's own conversation, the session
 * its settings name, or one of the tasks it started in the same store.
 * Only the chat's own asks the user anything, starts tasks, or hears the
 * turn note. None for a record that is no chat.
 */
export function sessionRole(
  chatId: ChatId,
  sessionId: StoreId.Session,
): "chat" | "task" | undefined {
  if (!resolveChat(chatId)) {
    return undefined;
  }
  return sessionOfChat(chatId) === sessionId ? "chat" : "task";
}

/**
 * Writes what the task list reads onto a task's session: who stopped its
 * last turn, and that something happened in it now. Queued per task, so two
 * landing together each build on the other.
 *
 * A stop is never taken off here: it is a record of something that happened,
 * and what retires it is a message starting a turn after it (`session-of.ts`).
 */
export function touchTask(
  chatId: ChatId,
  sessionId: StoreId.Session,
  changes: Pick<Session.Type, "stoppedBy"> = {},
): Promise<void> {
  return taskWrites(sessionId, async () => {
    const session = await ChatReads.session({ chatId, sessionId });
    if (session.isErr()) {
      return;
    }
    const saved = await ChatWrites.saveSession(
      { ...session.value, ...changes, updatedAt: new Date() },
      chatId,
    );
    if (saved.isErr()) {
      throw saved.error;
    }
  });
}

function taskOf(chatId: ChatId, session: Session.Type): ChatTask {
  return {
    chatId,
    createdAt: session.createdAt,
    handle: session.handle ?? session.id,
    id: session.id,
    ...(session.stoppedBy ? { stoppedBy: session.stoppedBy } : {}),
    title: session.title,
    updatedAt: session.updatedAt ?? session.createdAt,
  };
}
