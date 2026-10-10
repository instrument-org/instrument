import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { isWorking, latestStep } from "../../lib/chat/activity";
import { ensureChat } from "../../lib/chat/chat-records";
import {
  archiveChat,
  chatById,
  ChatSchema,
  markChatRead,
  markChatUnread,
  renameChat,
  setChatStarred,
  setChatTopics,
  settleChatTitle,
  unarchiveChat,
} from "../../lib/chat/chats";
import { ChatTaskSchema, listChildTasks } from "../../lib/chat/children";
import { liveChatList } from "../../lib/chat/live-chat-list";
import { retitleChat } from "../../lib/chat/retitle";
import { taskStanding } from "../../lib/chat/standing";
import { type RecordChanged, recordChanges } from "../../lib/record-changes";
import {
  chatOfSession,
  resolveChat,
  sessionOfChat,
} from "../../lib/record-folders";
import { trashChat } from "../../lib/trash-task";
import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema, type ChatId } from "../../schemas/chat-id";
import { chatRoutes } from "./chat";
import { base, toORPCError } from "../base";
import { distinct, liveRead } from "../live-read";

/** A task the chat started, as its tasks screen lists it. */
const ChildTaskSchema = ChatTaskSchema.extend({
  /** Where it stands and the line the list says about it. */
  standing: z.object({
    kind: z.enum(["done", "failed", "running", "waiting"]),
    line: z.string(),
  }),
  /** The label of its newest step of its own, when it gave one. */
  step: z.string().optional(),
  /** Whether a stop has something to end: an agent at work. */
  stoppable: z.boolean(),
});

export type ChildTask = z.output<typeof ChildTaskSchema>;

/** The tasks a chat created, newest activity first. */
async function childTasks(id: ChatId) {
  const tasks = await listChildTasks(id);
  return await Promise.all(
    tasks.map(async (task) => {
      const ref = { sessionId: task.id, chatId: id };
      const running = isWorking(id, task.id);
      const step = await latestStep(ref);
      return {
        ...task,
        standing: await taskStanding({ ...ref, isRunning: running }),
        ...(step ? { step } : {}),
        stoppable: running,
      };
    }),
  );
}

/**
 * Whether a change is to the chat whose tasks a list shows: what one of its
 * rows shows (its title, its standing, its step) is all in the chat's store,
 * and whether it works is its session's agent.
 */
function inChat(chatId: ChatId) {
  return (change: RecordChanged) =>
    change.id === chatId && change.kind !== "settings";
}

/**
 * A chat's tasks once, as the live list's first answer. The id must be a
 * chat's: nothing lists every chat's tasks.
 */
const childTasksRoute = base
  .input(z.object({ id: ChatIdSchema }))
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
  .input(z.object({ id: ChatIdSchema }))
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

/** Acts on the chat an id names; an id that is no chat's does nothing. */
async function whenChat(
  id: ChatId,
  act: (chatId: ChatId) => Promise<unknown>,
): Promise<void> {
  const chatId = resolveChat(id);
  if (chatId) {
    await act(chatId);
  }
}

/** One chat as the list shows it, or none for an id that is not a chat's. */
const chatByIdRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(ChatSchema.optional())
  .handler(({ input }) => chatById(input.id));

/** The chats, oldest first, kept current: see `liveChatList`. */
const liveListChatsRoute = base
  .output(eventIterator(ChatSchema.array()))
  .handler(async function* ({ signal }) {
    yield* liveChatList(signal);
  });

/** Takes a chat's unread mark off: the user has looked at it, or said so. */
const readChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.id, markChatRead);
  });

/** Marks a chat unread by the user's hand, which holds until they come back to it. */
const unreadChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.id, (chatId) =>
      markChatUnread(chatId, { byUser: true }),
    );
  });

/** Puts a chat away: out of the inbox, still in the list, marked. */
const archiveChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.id, archiveChat);
  });

/** Stars a chat, or takes the star off. */
const starChatRoute = base
  .input(z.object({ id: ChatIdSchema, starred: z.boolean() }))
  .handler(async ({ input }) => {
    await whenChat(input.id, (chatId) => setChatStarred(chatId, input.starred));
  });

/** Brings a chat back into the inbox. */
const unarchiveChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => {
    await whenChat(input.id, unarchiveChat);
  });

/**
 * Names a chat again from where it stands now, on the user's ask, as
 * often as they ask; answers with the title it has afterward, or nothing when
 * there was nothing to name it from. A name the user asked for settles the
 * title the same as one they typed.
 */
const retitleChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(z.object({ title: z.string().optional() }))
  .handler(async ({ input }) => {
    const sessionId = sessionOfChat(input.id);
    if (!sessionId) {
      return {};
    }
    const title = await retitleChat({ id: input.id, sessionId });
    if (title === undefined) {
      return {};
    }
    await settleChatTitle(input.id);
    return { title };
  });

/** Names a chat as the user typed it. */
const renameChatRoute = base
  .input(z.object({ id: ChatIdSchema, title: z.string().trim().min(1) }))
  .handler(async ({ input }) => {
    await whenChat(input.id, (chatId) => renameChat(chatId, input.title));
  });

/** The topics a chat carries, replaced whole. */
const setChatTopicsRoute = base
  .input(z.object({ id: ChatIdSchema, topics: z.array(z.string()) }))
  .handler(async ({ input }) => {
    await whenChat(input.id, (chatId) => setChatTopics(chatId, input.topics));
  });

/**
 * A chat's record, made before the window shows it, so the window never asks
 * for a chat that is not there yet, and named for the words it opens with.
 * The window picks the session its conversation will have, which is what
 * makes asking again safe: the same session answers with the same chat.
 */
const ensureChatRoute = base
  .input(
    z.object({
      firstWords: z.string().optional(),
      sessionId: StoreId.SessionSchema,
    }),
  )
  .output(z.object({ id: ChatIdSchema }))
  .handler(async ({ input }) => ({
    id: await ensureChat(input.sessionId, input.firstWords),
  }));

/**
 * A chat's session, which its transcript is read and its messages are sent
 * through, or none for an id that is no chat's.
 */
const chatSessionRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .output(z.object({ sessionId: StoreId.SessionSchema.nullable() }))
  .handler(({ input }) => {
    const chatId = resolveChat(input.id);
    return { sessionId: (chatId && sessionOfChat(chatId)) ?? null };
  });

/**
 * The chat a session is, or none: for an address that names a chat by its
 * session, as a link in an older reply or a memory saved then does.
 */
const chatOfSessionRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .output(z.object({ id: ChatIdSchema.nullable() }))
  .handler(({ input }) => ({ id: chatOfSession(input.sessionId) ?? null }));

/**
 * Deletes a chat with every task it started: their work stops, and the chat's
 * folder, which holds theirs, goes to the trash.
 */
const trashChatRoute = base
  .input(z.object({ id: ChatIdSchema }))
  .handler(async ({ context, errors, input }) => {
    const id = resolveChat(input.id);
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
  ...chatRoutes,
  archive: archiveChatRoute,
  byId: chatByIdRoute,
  ensure: ensureChatRoute,
  live: {
    ...chatRoutes.live,
    list: liveListChatsRoute,
    tasks: liveChildTasksRoute,
  },
  ofSession: chatOfSessionRoute,
  read: readChatRoute,
  rename: renameChatRoute,
  retitle: retitleChatRoute,
  session: chatSessionRoute,
  setTopics: setChatTopicsRoute,
  star: starChatRoute,
  tasks: childTasksRoute,
  trash: trashChatRoute,
  unarchive: unarchiveChatRoute,
  unread: unreadChatRoute,
};
