import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { changedMessageBatches } from "../../lib/changed-message-batches";
import { getTask } from "../../lib/get-tasks";
import { isWorking, latestStep } from "../../lib/chat/activity";
import { ensureChat } from "../../lib/chat/chat-records";
import {
  archiveChat,
  chatById,
  chatRecordTitle,
  ChatSchema,
  listChats,
  markChatSeen,
  markChatUnseen,
  renameChat,
  setChatStarred,
  setChatTopics,
  settleChatTitle,
  unarchiveChat,
} from "../../lib/chat/chats";
import { listChildTasks } from "../../lib/chat/children";
import { retitleChat } from "../../lib/chat/retitle";
import { taskStanding } from "../../lib/chat/standing";
import {
  chatIdOfTask,
  chatOfSession,
  chatTaskIds,
  isChatId,
  sessionOfChat,
} from "../../lib/record-folders";
import { taskDir } from "../../lib/task-dir-utils";
import { taskHold } from "../../lib/task-hold";
import { trashChat } from "../../lib/trash-task";
import { StoreId } from "../../schemas/store-id";
import { TaskSchema } from "../../schemas/task";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { base, toORPCError } from "../base";
import { publisher } from "../publisher";

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
  /** The chat it was filed from, absent for a task filed outside a turn. */
  chatSessionId: StoreId.SessionSchema.optional(),
  /** That chat's title, as the user knows it. */
  chatTitle: z.string().optional(),
  /** Whether a stop has something to end: an agent at work, or a hold on its start. */
  stoppable: z.boolean(),
});

export type ChildTask = z.output<typeof ChildTaskSchema>;

/** The tasks a chat created, newest activity first. */
async function childTasks(id: TaskId) {
  const tasks = await listChildTasks(id);
  return await Promise.all(
    tasks.map(async (task) => {
      const chatSessionId =
        task.parentTaskId === undefined
          ? undefined
          : sessionOfChat(task.parentTaskId);
      const chatTitle = chatSessionId
        ? await chatRecordTitle(chatSessionId)
        : undefined;
      const running = isWorking(task.id);
      return {
        ...task,
        dir: taskDir(task.id),
        standing: await taskStanding({ isRunning: running, taskId: task.id }),
        stoppable: running || taskHold(task.id) !== undefined,
        ...(chatSessionId ? { chatSessionId } : {}),
        ...(chatTitle === undefined ? {} : { chatTitle }),
      };
    }),
  );
}

/**
 * Fires whenever something a filed task's row shows may have moved: a task
 * filed, retitled, held or let go (`task.updated`), a message landing in one,
 * a turn starting a tool call (its step), a turn or session ending, a task
 * or chat deleted, or a chat retitled. Tokens streaming do not fire it, since
 * no row shows them.
 */
function childTaskChanges(signal: AbortSignal | undefined) {
  const messages = changedMessageBatches({ id: () => true }, signal);
  const subscriptions = [
    publisher.subscribe("task.updated", { signal }),
    publisher.subscribe("task.removed", { signal }),
    publisher.subscribe("chat.removed", { signal }),
    publisher.subscribe("session.added", { signal }),
    publisher.subscribe("session.done", { signal }),
    publisher.subscribe("session.removed", { signal }),
    publisher.subscribe("session.updated", { signal }),
  ];
  const partUpdates = publisher.subscribe("part.updated", { signal });
  async function* steps() {
    for await (const { part } of partUpdates) {
      if (
        part.type.startsWith("tool-") &&
        "state" in part &&
        part.state === "input-available"
      ) {
        yield null;
      }
    }
  }
  async function* changed() {
    for await (const _batch of messages) {
      yield null;
    }
  }
  async function* merged() {
    try {
      yield* mergeGenerators([
        changed(),
        steps(),
        ...subscriptions.map((subscription) => everyOne(subscription)),
      ]);
    } finally {
      await messages.return();
    }
  }
  return collapsed(merged());
}

/** A chat's tasks, re-read whenever one of them may have changed. */
const liveChildTasksRoute = base
  .input(z.object({ id: TaskIdSchema }))
  .output(eventIterator(ChildTaskSchema.array()))
  .handler(async function* ({ input, signal }) {
    const changes = childTaskChanges(signal);
    try {
      yield await childTasks(input.id);
      for await (const _change of changes) {
        yield await childTasks(input.id);
      }
    } finally {
      await changes.return();
    }
  });

/** One chat as the list shows it, or none for a session that is not a chat. */
const chatByIdRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .output(ChatSchema.optional())
  .handler(({ input }) => chatById(input.sessionId));

/**
 * Fires whenever anything lands in any chat of the task, a chat's
 * record changes, a chat's agent starts, moves, or ends, or the
 * workspace's apps change: a chat's holds name only the apps the workspace
 * has, so an app set up or removed from the Apps screen moves a row's marks
 * and the column's app rows without a message landing anywhere. The agent's
 * state is read off its actor rather than the store, so a turn ending, which
 * writes nothing after its last reply, is heard from the actor itself; read
 * only on writes, a list would say working for as long as it took the next
 * one to land. A task filed from a chat is heard when it starts a tool
 * call, since that is when the step its row shows changes, and not on every
 * token it streams; the rest of what it does reaches the list with the
 * chat's own writes, its wake among them. A deleted chat is heard from
 * `chat.removed`, since the index has forgotten it before anything is told. Subscribed the moment it is called rather than when it is
 * first pulled, so a read taken right after has nothing land unobserved
 * between the two; an event the read already covered only costs one re-read.
 * A burst of events collapses into one firing per pull, since the next batch
 * is only taken once the consumer has come back for it.
 */
export function chatChanges(signal: AbortSignal | undefined) {
  const batches = changedMessageBatches({ id: isChatId }, signal);
  const sessionUpdates = publisher.subscribe("session.updated", { signal });
  const sessionRemoved = publisher.subscribe("session.removed", { signal });
  const chatRemoved = publisher.subscribe("chat.removed", { signal });
  const sessionTags = publisher.subscribe("session.tagsChanged", { signal });
  const sessionDone = publisher.subscribe("session.done", { signal });
  const appUpdates = publisher.subscribe("app.updated", { signal });
  const partUpdates = publisher.subscribe("part.updated", { signal });
  async function* changed() {
    for await (const _batch of batches) {
      yield null;
    }
  }
  async function* forThisTask(
    generator:
      | typeof sessionDone
      | typeof sessionRemoved
      | typeof sessionTags
      | typeof sessionUpdates,
  ) {
    for await (const payload of generator) {
      if (isChatId(payload.id)) {
        yield null;
      }
    }
  }
  async function* childSteps() {
    for await (const { id: childId, part } of partUpdates) {
      if (
        part.type.startsWith("tool-") &&
        "state" in part &&
        part.state === "input-available" &&
        chatIdOfTask(childId) !== undefined
      ) {
        yield null;
      }
    }
  }
  async function* merged() {
    try {
      yield* mergeGenerators([
        changed(),
        forThisTask(sessionUpdates),
        forThisTask(sessionRemoved),
        forThisTask(sessionTags),
        forThisTask(sessionDone),
        everyOne(appUpdates),
        everyOne(chatRemoved),
        childSteps(),
      ]);
    } finally {
      await batches.return();
    }
  }
  return collapsed(merged());
}

/**
 * One firing for however many events landed since the consumer last came
 * back: a reader that re-reads everything on each firing does it once per
 * read, not once per event that arrived during the read.
 */
async function* collapsed(source: AsyncGenerator) {
  const state: {
    /** What ended the source, handed to the consumer as the source would have. */
    failure?: { error: unknown };
    finished: boolean;
    pending: boolean;
    wake?: () => void;
  } = { finished: false, pending: false };
  // Read through a call each time: the pump changes these between awaits.
  const isPending = () => state.pending;
  const isFinished = () => state.finished;
  void (async () => {
    try {
      for await (const _event of source) {
        state.pending = true;
        state.wake?.();
      }
    } catch (error) {
      state.failure = { error };
    } finally {
      state.finished = true;
      state.wake?.();
    }
  })();
  try {
    while (true) {
      if (!isPending() && !isFinished()) {
        await new Promise((resolve) => {
          state.wake = () => {
            resolve(undefined);
          };
        });
        state.wake = undefined;
      }
      if (!isPending()) {
        if (state.failure) {
          throw state.failure.error;
        }
        return;
      }
      state.pending = false;
      yield null;
    }
  } finally {
    // Not awaited: the source may be waiting on an event that ends only when
    // the request's signal does.
    void source.return(undefined);
  }
}

/** One firing per event, whatever it carries. */
async function* everyOne(generator: AsyncIterable<unknown>) {
  for await (const _payload of generator) {
    yield null;
  }
}

/** The chats, oldest first, re-read on every change in any chat, bursts collapsed. */
const liveListChatsRoute = base
  .output(eventIterator(ChatSchema.array()))
  .handler(async function* ({ signal }) {
    const changes = chatChanges(signal);
    try {
      yield await listChats();
      for await (const _change of changes) {
        yield await listChats();
      }
    } finally {
      await changes.return();
    }
  });

/** What the user has seen in a chat, so its count can clear. */
const seenChatRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await markChatSeen(input.sessionId);
  });

/** A chat the user wants back among the unread: its newest reply unseen again. */
const unseenChatRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await markChatUnseen(input.sessionId);
  });

/** Puts a chat away: out of the inbox, still in the list, marked. */
const archiveChatRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await archiveChat(input.sessionId);
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
    await setChatStarred(input.sessionId, input.starred);
  });

/** Brings a chat back into the inbox. */
const unarchiveChatRoute = base
  .input(z.object({ sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await unarchiveChat(input.sessionId);
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
    await settleChatTitle(input.sessionId);
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
    await renameChat(input.sessionId, input.title);
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
    await setChatTopics(input.sessionId, input.topics);
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
    const chatTasks = chatTaskIds(id);
    const result = await trashChat({
      id,
      workspaceConfig: context.workspaceConfig,
      workspaceRef: context.workspaceRef,
    });
    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }
    announceChatRemoved({ chatTasks, id, sessionId: input.sessionId });
  });

/**
 * Tells every listener a chat is gone, once the index has already forgotten
 * it: its tasks and itself as removed tasks, its session as removed, and
 * `chat.removed`, the one a listener can still tell was a chat's.
 */
export function announceChatRemoved({
  chatTasks,
  id,
  sessionId,
}: {
  chatTasks: TaskId[];
  id: TaskId;
  sessionId: StoreId.Session;
}) {
  for (const child of chatTasks) {
    publisher.publish("task.removed", { id: child });
  }
  publisher.publish("task.removed", { id });
  publisher.publish("session.removed", { id, sessionId });
  publisher.publish("chat.removed", { id, sessionId });
}

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
  taskStatus: childStatus,
  trash: trashChatRoute,
  unarchive: unarchiveChatRoute,
  unseen: unseenChatRoute,
};
