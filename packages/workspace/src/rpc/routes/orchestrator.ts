import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { changedMessageBatches } from "../../lib/changed-message-batches";
import { getTask } from "../../lib/get-tasks";
import {
  isWorking,
  latestStep,
  orchestratorActivity,
  OrchestratorActivitySchema,
} from "../../lib/orchestrator/activity";
import {
  ActivityEntrySchema,
  listActivityLog,
} from "../../lib/orchestrator/activity-log";
import { taskThreads } from "../../lib/orchestrator/attribution";
import { listChildTasks } from "../../lib/orchestrator/children";
import { ensureOrchestrator } from "../../lib/orchestrator/ensure";
import {
  ensureHomeFolder,
  ensureOutputFolder,
} from "../../lib/orchestrator/output-folder";
import { taskStanding } from "../../lib/orchestrator/standing";
import {
  archiveThread,
  listThreads,
  markThreadSeen,
  markThreadUnseen,
  setThreadStarred,
  setThreadTopics,
  ThreadSchema,
  unarchiveThread,
} from "../../lib/orchestrator/threads";
import {
  createTopic,
  listTopics,
  retireTopic,
  TOPIC_NAME_MAX,
  updateTopic,
} from "../../lib/orchestrator/topics";
import { Store } from "../../lib/store";
import { taskDir } from "../../lib/task-dir-utils";
import { setTaskState } from "../../lib/task-record";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { StoreId } from "../../schemas/store-id";
import { TaskSchema } from "../../schemas/task";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
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
    const task = await getTask(input.id, getWorkspaceConfig());
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
      /** The thread it was filed from, absent for a task filed outside a turn. */
      threadId: StoreId.SessionSchema.optional(),
      /** That thread's title, as the user knows it. */
      threadTitle: z.string().optional(),
    }).array(),
  )
  .handler(async ({ input }) => {
    const tasks = await listChildTasks(input.id);
    const filedIn = await taskThreads(input.id);
    const sessions = await Store.getSessions(input.id);
    const titles = new Map(
      sessions.isOk()
        ? sessions.value.map((session) => [session.id, session.title])
        : [],
    );
    return await Promise.all(
      tasks.map(async (task) => {
        const threadId = filedIn[task.id];
        const threadTitle = threadId ? titles.get(threadId) : undefined;
        return {
          ...task,
          dir: taskDir(task.id),
          standing: await taskStanding({
            isRunning: isWorking(task.id),
            taskId: task.id,
          }),
          ...(threadId ? { threadId } : {}),
          ...(threadTitle === undefined ? {} : { threadTitle }),
        };
      }),
    );
  });

/**
 * The orchestrator task and the session to talk to it in, created on first
 * use, with the home folder and the workspace folder attached to it.
 */
const ensure = base
  .output(
    z.object({
      sessionId: StoreId.SessionSchema,
      taskId: TaskIdSchema,
    }),
  )
  .handler(async ({ context, errors }) => {
    const result = await ensureOrchestrator();
    if (result.isErr()) {
      context.workspaceConfig.captureException(result.error);
      throw toORPCError(result.error, errors);
    }
    await ensureHomeFolder(result.value.taskId);
    await ensureOutputFolder(result.value.taskId);
    return result.value;
  });

const TopicSchema = z.object({
  about: z.string().optional(),
  color: z.string().optional(),
  createdAt: z.number(),
  emoji: z.string().optional(),
  id: z.string(),
  name: z.string(),
  retired: z.boolean().optional(),
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

/** The conversation's threads, oldest first. */
const listThreadsRoute = base
  .input(z.object({ id: TaskIdSchema }))
  .output(ThreadSchema.array())
  .handler(({ input }) => listThreads(input.id));

/**
 * Fires whenever anything lands in any thread of the task or a thread's
 * record changes. Subscribed the moment it is called rather than when it is
 * first pulled, so a read taken right after has nothing land unobserved
 * between the two; an event the read already covered only costs one re-read.
 * A burst of events collapses into one firing per pull, since the next batch
 * is only taken once the consumer has come back for it.
 */
function threadChanges(id: TaskId, signal: AbortSignal | undefined) {
  const batches = changedMessageBatches({ id }, signal);
  const sessionUpdates = publisher.subscribe("session.updated", { signal });
  const sessionRemoved = publisher.subscribe("session.removed", { signal });
  async function* changed() {
    for await (const _batch of batches) {
      yield null;
    }
  }
  async function* forThisTask(
    generator: typeof sessionRemoved | typeof sessionUpdates,
  ) {
    for await (const payload of generator) {
      if (payload.id === id) {
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
      ]);
    } finally {
      await batches.return();
    }
  }
  return merged();
}

/** The same list, re-read on every change in any thread, bursts collapsed. */
const liveListThreadsRoute = base
  .input(z.object({ id: TaskIdSchema }))
  .output(eventIterator(ThreadSchema.array()))
  .handler(async function* ({ input, signal }) {
    const changes = threadChanges(input.id, signal);
    try {
      yield await listThreads(input.id);
      for await (const _change of changes) {
        yield await listThreads(input.id);
      }
    } finally {
      await changes.return();
    }
  });

/**
 * What happened across every thread, newest first, with the thread each
 * entry belongs to; nothing is stored for it.
 */
const listActivityLogRoute = base
  .input(
    z.object({
      id: TaskIdSchema,
      limit: z.number().int().positive().optional(),
    }),
  )
  .output(ActivityEntrySchema.array())
  .handler(({ input }) =>
    listActivityLog(input.id, {
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }),
  );

/** The same log, re-read on every change in any thread, bursts collapsed. */
const liveListActivityLogRoute = base
  .input(
    z.object({
      id: TaskIdSchema,
      limit: z.number().int().positive().optional(),
    }),
  )
  .output(eventIterator(ActivityEntrySchema.array()))
  .handler(async function* ({ input, signal }) {
    const options = input.limit === undefined ? {} : { limit: input.limit };
    const changes = threadChanges(input.id, signal);
    try {
      yield await listActivityLog(input.id, options);
      for await (const _change of changes) {
        yield await listActivityLog(input.id, options);
      }
    } finally {
      await changes.return();
    }
  });

/** What the user has seen in a thread, so its count can clear. */
const seenThreadRoute = base
  .input(z.object({ id: TaskIdSchema, sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await markThreadSeen(input.id, input.sessionId);
  });

/** A thread the user wants back among the unread: its newest reply unseen again. */
const unseenThreadRoute = base
  .input(z.object({ id: TaskIdSchema, sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await markThreadUnseen(input.id, input.sessionId);
  });

/** Puts a thread away: out of the inbox, still in the list, marked. */
const archiveThreadRoute = base
  .input(z.object({ id: TaskIdSchema, sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await archiveThread(input.id, input.sessionId);
  });

/** Stars a thread, or takes the star off. */
const starThreadRoute = base
  .input(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
      starred: z.boolean(),
    }),
  )
  .handler(async ({ input }) => {
    await setThreadStarred(input.id, input.sessionId, input.starred);
  });

/** Brings a thread back into the inbox. */
const unarchiveThreadRoute = base
  .input(z.object({ id: TaskIdSchema, sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await unarchiveThread(input.id, input.sessionId);
  });

/** The topics a thread carries, replaced whole. */
const setThreadTopicsRoute = base
  .input(
    z.object({
      id: TaskIdSchema,
      sessionId: StoreId.SessionSchema,
      topics: z.array(z.string()),
    }),
  )
  .handler(async ({ input }) => {
    await setThreadTopics(input.id, input.sessionId, input.topics);
  });

/** The conversation's topics: in use first, in the order made, then retired. */
const listTopicsRoute = base
  .input(z.object({ id: TaskIdSchema }))
  .output(TopicSchema.array())
  .handler(({ input }) => listTopics(input.id));

/** Makes a topic under a name. */
const createTopicRoute = base
  .input(
    TopicMarkSchema.extend({
      id: TaskIdSchema,
      name: TopicNameSchema,
    }),
  )
  .output(TopicSchema)
  .handler(({ input }) =>
    createTopic(input.id, {
      ...(input.color ? { color: input.color } : {}),
      ...(input.emoji ? { emoji: input.emoji } : {}),
      name: input.name,
    }),
  );

/** Changes what the user chose about a topic: its name, its mark, its tint. */
const updateTopicRoute = base
  .input(
    TopicMarkSchema.extend({
      id: TaskIdSchema,
      name: TopicNameSchema.optional(),
      topicId: z.string(),
    }),
  )
  .handler(async ({ input }) => {
    await updateTopic(input.id, input.topicId, {
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.emoji === undefined ? {} : { emoji: input.emoji }),
      ...(input.name === undefined ? {} : { name: input.name }),
    });
  });

/** Takes a topic out of the menus, leaving the threads that carry it alone. */
const retireTopicRoute = base
  .input(z.object({ id: TaskIdSchema, topicId: z.string() }))
  .handler(async ({ input }) => {
    await retireTopic(input.id, input.topicId);
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
 * What the conversation asks its window to open, as it asks, each with the
 * thread that asked when the command ran in one.
 */
const open = base
  .input(z.object({ id: TaskIdSchema }))
  .output(
    eventIterator(
      z.union([
        z.object({
          kind: z.literal("page"),
          requestId: z.string(),
          sessionId: StoreId.SessionSchema.optional(),
          url: z.string(),
        }),
        z.object({
          kind: z.literal("path"),
          mount: z.string(),
          sessionId: StoreId.SessionSchema.optional(),
        }),
      ]),
    ),
  )
  .handler(async function* ({ input, signal }) {
    for await (const event of publisher.subscribe("orchestrator.open", {
      signal,
    })) {
      if (event.id === input.id) {
        yield {
          ...event.target,
          ...(event.sessionId ? { sessionId: event.sessionId } : {}),
        };
      }
    }
  });

/** The window's answer to an `open`: the tab it made for the page, by the id a task takes. */
const opened = base
  .input(
    z.object({
      id: TaskIdSchema,
      requestId: z.string(),
      tabId: StoreId.SessionSchema,
    }),
  )
  .handler(({ input }) => {
    publisher.publish("orchestrator.opened", input);
  });

export const orchestrator = {
  activity,
  activityLog: {
    list: listActivityLogRoute,
    live: { list: liveListActivityLogRoute },
  },
  children,
  childStatus,
  ensure,
  events: { open },
  opened,
  setActiveTab,
  threads: {
    archive: archiveThreadRoute,
    list: listThreadsRoute,
    live: { list: liveListThreadsRoute },
    seen: seenThreadRoute,
    setTopics: setThreadTopicsRoute,
    star: starThreadRoute,
    unarchive: unarchiveThreadRoute,
    unseen: unseenThreadRoute,
  },
  topics: {
    create: createTopicRoute,
    list: listTopicsRoute,
    retire: retireTopicRoute,
    update: updateTopicRoute,
  },
};
