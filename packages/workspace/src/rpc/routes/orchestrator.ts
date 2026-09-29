import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { changedMessageBatches } from "../../lib/changed-message-batches";
import { getTask } from "../../lib/get-tasks";
import {
  listMemorySources,
  MemorySourceSchema,
} from "../../lib/memory/sources";
import {
  ensureMemoryDir,
  forgetMemories,
  listMemories,
  memoryDir,
  MemorySchema,
} from "../../lib/memory/store";
import { startWatchingMemory } from "../../lib/memory/watch";
import {
  isWorking,
  latestStep,
  orchestratorActivity,
  OrchestratorActivitySchema,
} from "../../lib/orchestrator/activity";
import { ensureChat } from "../../lib/orchestrator/chat-records";
import {
  archiveChat,
  ChatSchema,
  listChats,
  markChatSeen,
  markChatUnseen,
  renameChat,
  setChatStarred,
  setChatTopics,
  settleChatTitle,
  unarchiveChat,
} from "../../lib/orchestrator/chats";
import { listChildTasks } from "../../lib/orchestrator/children";
import { ensureOrchestrator } from "../../lib/orchestrator/ensure";
import {
  ensureHomeFolder,
  ensureOutputFolder,
  outputFolderPath,
} from "../../lib/orchestrator/output-folder";
import { retitleChat } from "../../lib/orchestrator/retitle";
import { taskStanding } from "../../lib/orchestrator/standing";
import {
  createTopic,
  listTopics,
  retireTopic,
  TOPIC_NAME_MAX,
  TopicSchema,
  updateTopic,
} from "../../lib/orchestrator/topics";
import {
  chatOfSession,
  chatTaskIds,
  isChatId,
  sessionOfChat,
} from "../../lib/record-folders";
import { Store } from "../../lib/store";
import { taskDir } from "../../lib/task-dir-utils";
import { setTaskState } from "../../lib/task-record";
import { getTaskSettings } from "../../lib/task-settings";
import { trashChat } from "../../lib/trash-task";
import { StoreId } from "../../schemas/store-id";
import { TaskSchema } from "../../schemas/task";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import {
  WindowTabAnswerSchema,
  WindowTabRequestSchema,
} from "../../schemas/window-tab";
import { BrowserTargetIdSchema } from "../../types";
import { base, toORPCError } from "../base";
import { publisher } from "../publisher";

/** What the orchestrator's tasks are doing right now. */
const activity = base
  .input(z.object({ id: TaskIdSchema }))
  .output(OrchestratorActivitySchema)
  .handler(({ input }) => orchestratorActivity(input.id));

/** Where one task the orchestrator created stands this moment, for a card that follows it. */
const childStatus = base
  .input(z.object({ id: TaskIdSchema }))
  .output(
    z.object({
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
    return {
      isWorking: working,
      ...(step ? { step } : {}),
      title: task.value.title,
      updatedAt: task.value.updatedAt.getTime(),
    };
  });

/** The tasks an orchestrator created, newest activity first. */
const children = base
  .input(z.object({ id: TaskIdSchema }))
  .output(
    TaskSchema.extend({
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
    }).array(),
  )
  .handler(async ({ input }) => {
    const tasks = await listChildTasks(input.id);
    return await Promise.all(
      tasks.map(async (task) => {
        const chatSessionId =
          task.parentTaskId === undefined
            ? undefined
            : sessionOfChat(task.parentTaskId);
        const chat =
          chatSessionId && task.parentTaskId
            ? await Store.getSession(chatSessionId, task.parentTaskId)
            : undefined;
        const chatTitle = chat?.isOk() ? chat.value.title : undefined;
        return {
          ...task,
          dir: taskDir(task.id),
          standing: await taskStanding({
            isRunning: isWorking(task.id),
            taskId: task.id,
          }),
          ...(chatSessionId ? { chatSessionId } : {}),
          ...(chatTitle === undefined ? {} : { chatTitle }),
        };
      }),
    );
  });

/**
 * The window's own record, created on first use, with the home folder and the
 * workspace folder attached to it: every chat starts with what it holds.
 */
const ensure = base
  .output(z.object({ taskId: TaskIdSchema }))
  .handler(async ({ context, errors }) => {
    const result = await ensureOrchestrator();
    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }
    await ensureHomeFolder(result.value.taskId);
    await ensureOutputFolder(result.value.taskId);
    // Folder decoration must not prevent a conversation from opening.
    void context.workspaceConfig
      .ensureOutputFolderIcon?.(outputFolderPath())
      .catch((error: unknown) => {
        context.workspaceConfig.captureException(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    return result.value;
  });

/** What the user picks about a topic: its mark, its tint. */
const TopicMarkSchema = z.object({
  color: z.string().max(9).optional(),
  emoji: z.string().max(8).optional(),
});

const TopicNameSchema = z
  .string()
  .min(1)
  .max(TOPIC_NAME_MAX * 2);

/** The conversation's chats, oldest first. */
const listChatsRoute = base
  .output(ChatSchema.array())
  .handler(() => listChats());

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
  const parents = new Map<TaskId, Promise<TaskId | undefined>>();
  const parentOf = (taskId: TaskId) => {
    const known = parents.get(taskId);
    if (known) {
      return known;
    }
    const read = getTaskSettings(taskDir(taskId)).then(
      (settings) => settings?.parentTaskId,
    );
    parents.set(taskId, read);
    return read;
  };
  async function* childSteps() {
    for await (const { id: childId, part } of partUpdates) {
      if (
        !isChatId(childId) &&
        part.type.startsWith("tool-") &&
        "state" in part &&
        part.state === "input-available" &&
        isChatId((await parentOf(childId)) ?? "")
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
  return merged();
}

/** One firing per event, whatever it carries. */
async function* everyOne(generator: AsyncIterable<unknown>) {
  for await (const _payload of generator) {
    yield null;
  }
}

/** The same list, re-read on every change in any chat, bursts collapsed. */
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

/** The conversation's topics: in use first, in the order made, then retired. */
const listTopicsRoute = base
  .output(TopicSchema.array())
  .handler(() => listTopics());

/** Makes a topic under a name. */
const createTopicRoute = base
  .input(
    TopicMarkSchema.extend({
      name: TopicNameSchema,
    }),
  )
  .output(TopicSchema)
  .handler(({ input }) =>
    createTopic({
      ...(input.color ? { color: input.color } : {}),
      ...(input.emoji ? { emoji: input.emoji } : {}),
      name: input.name,
    }),
  );

/** Changes what the user chose about a topic: its name, its mark, its tint. */
const updateTopicRoute = base
  .input(
    TopicMarkSchema.extend({
      name: TopicNameSchema.optional(),
      topicId: z.string(),
    }),
  )
  .handler(async ({ input }) => {
    await updateTopic(input.topicId, {
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.emoji === undefined ? {} : { emoji: input.emoji }),
      ...(input.name === undefined ? {} : { name: input.name }),
    });
  });

/** Takes a topic out of the menus, leaving the chats that carry it alone. */
const retireTopicRoute = base
  .input(z.object({ topicId: z.string() }))
  .handler(async ({ input }) => {
    await retireTopic(input.topicId);
  });

/**
 * The tab the window's browser has in front, which is the tab the
 * orchestrator's own `agent-browser` drives; null once no tab is open.
 */
const setActiveTab = base
  .input(
    z.object({ id: TaskIdSchema, targetId: BrowserTargetIdSchema.nullable() }),
  )
  .handler(async ({ input }) => {
    await setTaskState(taskDir(input.id), {
      browserTargetId: input.targetId ?? undefined,
    });
  });

/**
 * What the conversation and its tasks ask of the window's tabs, as they ask,
 * each with the chat it belongs to when there is one.
 */
const tab = base
  .input(z.object({ id: TaskIdSchema }))
  .output(eventIterator(WindowTabRequestSchema))
  .handler(async function* ({ input, signal }) {
    for await (const event of publisher.subscribe("orchestrator.tab", {
      signal,
    })) {
      // A chat's own asks, the window record's, and those of any task asking
      // among a chat's tabs all go to the window.
      if (
        event.id === input.id ||
        isChatId(event.id) ||
        event.sessionId !== undefined
      ) {
        const { id: _asker, ...request } = event;
        yield request;
      }
    }
  });

const MemoryFolderSchema = z.object({
  /** Where the files are, for a viewer that opens the folder. */
  dir: z.string(),
  memories: MemorySchema.array(),
});

/** What the conversation remembers about the user: the folder, and every memory in it newest first. */
async function readMemoryFolder() {
  const dir = memoryDir();
  await ensureMemoryDir(dir);
  return { dir, memories: await listMemories(dir) };
}

const listMemoryRoute = base
  .output(MemoryFolderSchema)
  .handler(() => readMemoryFolder());

/** The same folder, re-read whenever a memory is saved, corrected, or forgotten. */
const liveListMemoryRoute = base
  .output(eventIterator(MemoryFolderSchema))
  .handler(async function* ({ signal }) {
    const changes = publisher.subscribe("memory.changed", { signal });
    // Held for the life of the subscription, so a file edited in the folder
    // reaches the screen listing it.
    const stopWatching = await startWatchingMemory();
    try {
      yield await readMemoryFolder();
      for await (const _change of changes) {
        yield await readMemoryFolder();
      }
    } finally {
      stopWatching();
    }
  });

/** The coding agents on this computer whose memory is there to import. */
const listMemorySourcesRoute = base
  .output(MemorySourceSchema.array())
  .handler(() => listMemorySources());

/** Drops one memory by name. Nothing happens when there is none by it. */
const forgetMemoryRoute = base
  .input(z.object({ names: z.array(z.string()).min(1) }))
  .handler(async ({ input }) => {
    await forgetMemories(memoryDir(), input.names);
  });

/** The window's answer to an ask of its tabs: the tab it acted on or made, or why it did nothing. */
const tabDone = base
  .input(WindowTabAnswerSchema.extend({ id: TaskIdSchema }))
  .handler(({ input }) => {
    publisher.publish("orchestrator.tabDone", input);
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

export const orchestrator = {
  activity,
  chats: {
    archive: archiveChatRoute,
    ensure: ensureChatRoute,
    list: listChatsRoute,
    live: { list: liveListChatsRoute },
    of: chatOfRoute,
    rename: renameChatRoute,
    retitle: retitleChatRoute,
    seen: seenChatRoute,
    setTopics: setChatTopicsRoute,
    star: starChatRoute,
    trash: trashChatRoute,
    unarchive: unarchiveChatRoute,
    unseen: unseenChatRoute,
  },
  children,
  childStatus,
  ensure,
  events: { tab },
  memory: {
    forget: forgetMemoryRoute,
    list: listMemoryRoute,
    live: { list: liveListMemoryRoute },
    sources: listMemorySourcesRoute,
  },
  setActiveTab,
  tabDone,
  topics: {
    create: createTopicRoute,
    list: listTopicsRoute,
    retire: retireTopicRoute,
    update: updateTopicRoute,
  },
};
