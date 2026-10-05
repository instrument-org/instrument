import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { getTask } from "../../lib/get-tasks";
import { isWorking, latestStep } from "../../lib/chat/activity";
import { ensureChat } from "../../lib/chat/chat-records";
import {
  archiveChat,
  chatById,
  ChatSchema,
  markChatSeen,
  markChatUnseen,
  renameChat,
  setChatStarred,
  setChatTopics,
  settleChatTitle,
  unarchiveChat,
} from "../../lib/chat/chats";
import { listChildTasks } from "../../lib/chat/children";
import { liveChatList } from "../../lib/chat/live-chat-list";
import { retitleChat } from "../../lib/chat/retitle";
import { taskStanding } from "../../lib/chat/standing";
import { type RecordChanged, recordChanges } from "../../lib/record-changes";
import {
  chatOfSession,
  owningChat,
  resolveChat,
} from "../../lib/record-folders";
import { taskDir } from "../../lib/task-dir-utils";
import { taskHold } from "../../lib/task-hold";
import { trashChat } from "../../lib/trash-task";
import { StoreId } from "../../schemas/store-id";
import { TaskSchema } from "../../schemas/task";
import { TaskIdSchema } from "../../schemas/task-id";
import { base, toORPCError } from "../base";
import { distinct, liveRead } from "../live-read";
import { type ChatId } from "../../schemas/chat-id";

/** Where one task the chat created stands this moment, for a card that follows it. */
const childStatus = base
  .input(z.object({ id: TaskIdSchema }))
  .output(
    z.object({
      /** Why it has not started yet, in the user's words, while it is held. */
      held: z.string().optional(),
      isWorking: z.boolean(),
      step: z.string().optional(),
      title: z.string(),
      updatedAt: z.number(),
    }),
  )
  .handler(async ({ errors, input }) => {
    const task = await getTask(input.id);
    if (task.isErr()) {
      throw toORPCError(task.error, errors);
    }
    const working = isWorking(input.id);
    const step = working ? await latestStep(input.id) : undefined;
    const held = taskHold(input.id);
    return {
      ...(held ? { held: held.userReason } : {}),
      isWorking: working,
      ...(step ? { step } : {}),
      title: task.value.title,
      updatedAt: task.value.updatedAt.getTime(),
    };
  });

/** A task the window filed, as its tasks screen lists it. */
const ChildTaskSchema = TaskSchema.extend({
  // With each one's folder on disk: what a link into `/tasks/<id>` opens.
  dir: z.string(),
  /** Where it stands and the line the list says about it. */
  standing: z.object({
    kind: z.enum(["done", "failed", "running", "waiting"]),
    line: z.string(),
  }),
  /** Whether a stop has something to end: an agent at work, or a hold on its start. */
  stoppable: z.boolean(),
});

export type ChildTask = z.output<typeof ChildTaskSchema>;

/** The tasks a chat created, newest activity first. */
async function childTasks(id: ChatId) {
  const tasks = await listChildTasks(id);
  return await Promise.all(
    tasks.map(async (task) => {
      const running = isWorking(task.id);
      return {
        ...task,
        dir: taskDir(task.id),
        standing: await taskStanding({ isRunning: running, taskId: task.id }),
        stoppable: running || taskHold(task.id) !== undefined,
      };
    }),
  );
}

/**
 * Whether a change is to a task the chat filed: what one of its rows shows
 * (its title, its standing, its step) is all in the task's own record.
 */
function inChat(chatId: ChatId) {
  return (change: RecordChanged) =>
    change.kind === "removed"
      ? change.ref.kind === "task" && change.ref.chatId === chatId
      : owningChat(change.id) === chatId;
}

/**
 * A chat's tasks once, as the live list's first answer. The id must be a
 * chat's: nothing lists every chat's tasks.
 */
const childTasksRoute = base
  .input(z.object({ id: TaskIdSchema }))
  .output(ChildTaskSchema.array())
  .handler(async ({ errors, input }) => {
    const chatId = resolveChat(input.id);
    if (!chatId) {
      throw errors.NOT_FOUND({ message: "That chat is not there any more." });
    }
    return await childTasks(chatId);
  });

/** A chat's tasks, re-read whenever one of them may have changed. */
const liveChildTasksRoute = base
  .input(z.object({ id: TaskIdSchema }))
  .output(eventIterator(ChildTaskSchema.array()))
  .handler(async function* ({ errors, input, signal }) {
    const chatId = resolveChat(input.id);
    if (!chatId) {
      throw errors.NOT_FOUND({ message: "That chat is not there any more." });
    }
    yield* distinct(
      liveRead({
        changes: [recordChanges(signal, inChat(chatId))],
        read: () => childTasks(chatId),
      }),
    );
  });

/**
 * The window and the agent name a chat by its session, so the routes take
 * that and act on the chat it is; a session that is no chat's does nothing.
 */
async function whenChat(
  sessionId: StoreId.Session,
  act: (chatId: ChatId) => Promise<unknown>,
): Promise<void> {
  const chatId = chatOfSession(sessionId);
  if (chatId) {
    await act(chatId);
  }
}

/** One chat as the list shows it, or none for a session that is not a chat. */
const chatByIdRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .output(ChatSchema.optional())
  .handler(({ input }) => {
    const chatId = chatOfSession(input.sessionId);
    return chatId ? chatById(chatId) : undefined;
  });

/** The chats, oldest first, kept current: see `liveChatList`. */
const liveListChatsRoute = base
  .output(eventIterator(ChatSchema.array()))
  .handler(async function* ({ signal }) {
    yield* liveChatList(signal);
  });

/** What the user has seen in a chat, so its count can clear. */
const seenChatRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.sessionId, (chatId) => markChatSeen(chatId));
  });

/** A chat the user wants back among the unread: its newest reply unseen again. */
const unseenChatRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.sessionId, (chatId) => markChatUnseen(chatId));
  });

/** Puts a chat away: out of the inbox, still in the list, marked. */
const archiveChatRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.sessionId, (chatId) => archiveChat(chatId));
  });

/** Stars a chat, or takes the star off. */
const starChatRoute = base
  .input(
    z.object({
      sessionId: StoreId.SessionSchema,
      starred: z.boolean(),
    }),
  )
  .handler(async ({ input }) => {
    await whenChat(input.sessionId, (chatId) =>
      setChatStarred(chatId, input.starred),
    );
  });

/** Brings a chat back into the inbox. */
const unarchiveChatRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.sessionId, (chatId) => unarchiveChat(chatId));
  });

/**
 * Names a chat again from where it stands now, on the user's ask, as
 * often as they ask; answers with the title it has afterward, or nothing when
 * there was nothing to name it from. A name the user asked for settles the
 * title the same as one they typed.
 */
const retitleChatRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .output(z.object({ title: z.string().optional() }))
  .handler(async ({ input }) => {
    const id = chatOfSession(input.sessionId);
    if (!id) {
      return {};
    }
    const title = await retitleChat({ id, sessionId: input.sessionId });
    if (title === undefined) {
      return {};
    }
    await settleChatTitle(id);
    return { title };
  });

/** Names a chat as the user typed it. */
const renameChatRoute = base
  .input(
    z.object({
      sessionId: StoreId.SessionSchema,
      title: z.string().trim().min(1),
    }),
  )
  .handler(async ({ input }) => {
    await whenChat(input.sessionId, (chatId) =>
      renameChat(chatId, input.title),
    );
  });

/** The topics a chat carries, replaced whole. */
const setChatTopicsRoute = base
  .input(
    z.object({
      sessionId: StoreId.SessionSchema,
      topics: z.array(z.string()),
    }),
  )
  .handler(async ({ input }) => {
    await whenChat(input.sessionId, (chatId) =>
      setChatTopics(chatId, input.topics),
    );
  });

/**
 * A chat's record, made before the window shows it, so the window never asks
 * for a chat that is not there yet, and named for the words it opens with.
 * Asked again for the same session, it answers with the same chat.
 */
const ensureChatRoute = base
  .input(
    z.object({
      firstWords: z.string().optional(),
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.object({ taskId: TaskIdSchema }))
  .handler(async ({ input }) => ({
    taskId: await ensureChat(input.sessionId, input.firstWords),
  }));

/** The record a chat's session is in, or none for a session that is not a chat's. */
const chatOfRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .output(z.object({ taskId: TaskIdSchema.nullable() }))
  .handler(({ input }) => ({
    taskId: chatOfSession(input.sessionId) ?? null,
  }));

/**
 * Deletes a chat with every task it started: their work stops, and the chat's
 * folder, which holds theirs, goes to the trash.
 */
const trashChatRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(async ({ context, errors, input }) => {
    const id = chatOfSession(input.sessionId);
    if (!id) {
      throw errors.NOT_FOUND({ message: "That chat is not there any more." });
    }
    const result = await trashChat({
      id,
      workspaceConfig: context.workspaceConfig,
      workspaceRef: context.workspaceRef,
    });
    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }
  });

export const chats = {
  archive: archiveChatRoute,
  byId: chatByIdRoute,
  ensure: ensureChatRoute,
  live: { list: liveListChatsRoute, tasks: liveChildTasksRoute },
  of: chatOfRoute,
  rename: renameChatRoute,
  retitle: retitleChatRoute,
  seen: seenChatRoute,
  setTopics: setChatTopicsRoute,
  star: starChatRoute,
  tasks: childTasksRoute,
  taskStatus: childStatus,
  trash: trashChatRoute,
  unarchive: unarchiveChatRoute,
  unseen: unseenChatRoute,
};
