import { z } from "zod";

import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { type Session } from "../../schemas/session";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { createWriteQueue } from "../create-write-queue";
import { resolveChat, sessionOfChat } from "../record-folders";
import { Store } from "../store";

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
  status: z.enum(["done", "failed", "running", "waiting"]).optional(),
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
    const saved = await Store.saveSession(session, chatId);
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
  const sessions = await Store.getSessions(chatId, {
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
  const session = await Store.getSession(sessionId, chatId);
  return chatSession && session.isOk() && session.value.parentId === chatSession
    ? taskOf(chatId, session.value)
    : undefined;
}

/**
 * The chat a session is the conversation of, or none for a task's session
 * and for a record that is no chat. What sets the conversation the user
 * talks in apart from the tasks it started in the same store: only it asks
 * the user anything, starts tasks, or hears the turn note.
 */
export function chatConversation(
  taskId: TaskId,
  sessionId: StoreId.Session,
): ChatId | undefined {
  const chatId = resolveChat(taskId);
  return chatId && sessionOfChat(chatId) === sessionId ? chatId : undefined;
}

/**
 * Whether a session is one of a chat's tasks: a session in a chat's store
 * that is not the chat's own conversation.
 */
export function isTaskSession(
  taskId: TaskId,
  sessionId: StoreId.Session,
): boolean {
  const chatId = resolveChat(taskId);
  return chatId !== undefined && sessionOfChat(chatId) !== sessionId;
}

/**
 * Writes what the task list reads onto a task's session: where it stands,
 * and that something happened in it now. Queued per task, so two landing
 * together each build on the other.
 */
export function touchTask(
  chatId: ChatId,
  sessionId: StoreId.Session,
  changes: Pick<Session.Type, "status"> = {},
): Promise<void> {
  return taskWrites(sessionId, async () => {
    const session = await Store.getSession(sessionId, chatId);
    if (session.isErr()) {
      return;
    }
    const saved = await Store.saveSession(
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
    ...(session.status ? { status: session.status } : {}),
    title: session.title,
    updatedAt: session.updatedAt ?? session.createdAt,
  };
}
