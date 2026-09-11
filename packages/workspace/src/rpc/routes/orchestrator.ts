import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { getTask } from "../../lib/get-tasks";
import {
  isWorking,
  latestStep,
  orchestratorActivity,
  OrchestratorActivitySchema,
} from "../../lib/orchestrator/activity";
import { taskChannels } from "../../lib/orchestrator/attribution";
import {
  archiveChannel,
  CHANNEL_NAME_MAX,
  channelName,
  channelStandings,
  createChannel,
  listChannels,
  markChannelSeen,
  reorderChannels,
  updateChannel,
} from "../../lib/orchestrator/channels";
import { listChildTasks } from "../../lib/orchestrator/children";
import { ensureOrchestrator } from "../../lib/orchestrator/ensure";
import {
  ensureHomeFolder,
  ensureOutputFolder,
} from "../../lib/orchestrator/output-folder";
import { taskStanding } from "../../lib/orchestrator/standing";
import { taskDir } from "../../lib/task-dir-utils";
import { setTaskState } from "../../lib/task-record";
import { getWorkspaceConfig } from "../../lib/workspace-config";
import { StoreId } from "../../schemas/store-id";
import { TaskSchema } from "../../schemas/task";
import { TaskIdSchema } from "../../schemas/task-id";
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
      /**
       * The channel it was filed from, as the user knows it, absent for a task
       * made before channels or filed from one since archived.
       */
      channel: z
        .object({
          color: z.string().optional(),
          emoji: z.string().optional(),
          /** The channel the conversation started in, which wears the app's mark. */
          isHome: z.boolean().optional(),
          name: z.string(),
        })
        .optional(),
      /** The same channel by its session id, for the window's own bookkeeping. */
      channelId: StoreId.SessionSchema.optional(),
      // With each one's folder on disk: what a link into `/tasks/<id>` opens.
      dir: z.string(),
      /** Where it stands and the line the list says about it. */
      standing: z.object({
        kind: z.enum(["done", "failed", "running", "waiting"]),
        line: z.string(),
      }),
    }).array(),
  )
  .handler(async ({ input }) => {
    const tasks = await listChildTasks(input.id);
    const filedIn = await taskChannels(input.id);
    // The session a task was filed from is an id; the row wants the whole mark
    // the user chose for it, so a task is drawn in the colors of the channel it
    // was asked for in wherever it is named.
    const channels = await listChannels(input.id);
    const known = new Map(
      channels.map((channel, index) => [
        channel.id,
        {
          ...(channel.color ? { color: channel.color } : {}),
          ...(channel.emoji ? { emoji: channel.emoji } : {}),
          ...(index === 0 ? { isHome: true } : {}),
          name: channel.name,
        },
      ]),
    );
    return await Promise.all(
      tasks.map(async (task) => {
        const filed = filedIn[task.id];
        const channel = filed ? known.get(filed) : undefined;
        return {
          ...task,
          ...(channel ? { channel } : {}),
          ...(filed && channel ? { channelId: filed } : {}),
          dir: taskDir(task.id),
          standing: await taskStanding({
            isRunning: isWorking(task.id),
            taskId: task.id,
          }),
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

const ChannelSchema = z.object({
  color: z.string().optional(),
  createdAt: z.number(),
  emoji: z.string().optional(),
  id: StoreId.SessionSchema,
  name: z.string(),
  needsYou: z.boolean(),
  unread: z.number(),
  updatedAt: z.number(),
});

/** What the user picks about a channel: its mark, its tint. */
const ChannelMarkSchema = z.object({
  color: z.string().max(9).optional(),
  emoji: z.string().max(8).optional(),
});

/** The conversation's channels, in the order they were made. */
const listChannelsRoute = base
  .input(z.object({ id: TaskIdSchema }))
  .output(ChannelSchema.array())
  .handler(({ input }) => channelStandings(input.id));

/** Makes a channel: a session of the same conversation under a name. */
const createChannelRoute = base
  .input(
    ChannelMarkSchema.extend({
      id: TaskIdSchema,
      name: z
        .string()
        .min(1)
        .max(CHANNEL_NAME_MAX * 2),
    }),
  )
  .output(ChannelSchema.omit({ needsYou: true, unread: true, updatedAt: true }))
  .handler(({ input }) =>
    createChannel(input.id, channelName(input.name), {
      ...(input.color ? { color: input.color } : {}),
      ...(input.emoji ? { emoji: input.emoji } : {}),
    }),
  );

/** Changes what the user chose about a channel: its name, its mark, its tint. */
const updateChannelRoute = base
  .input(
    ChannelMarkSchema.extend({
      id: TaskIdSchema,
      name: z
        .string()
        .min(1)
        .max(CHANNEL_NAME_MAX * 2)
        .optional(),
      sessionId: StoreId.SessionSchema,
    }),
  )
  .handler(async ({ input }) => {
    await updateChannel(input.id, input.sessionId, {
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.emoji === undefined ? {} : { emoji: input.emoji }),
      ...(input.name === undefined ? {} : { name: input.name }),
    });
  });

/** Takes a channel out of the strip, keeping what was said in it. */
const archiveChannelRoute = base
  .input(z.object({ id: TaskIdSchema, sessionId: StoreId.SessionSchema }))
  .output(z.object({ archived: z.boolean(), reason: z.string().optional() }))
  .handler(({ input }) => archiveChannel(input.id, input.sessionId));

/** The order the user dragged the strip into. */
const reorderChannelsRoute = base
  .input(z.object({ id: TaskIdSchema, ids: StoreId.SessionSchema.array() }))
  .handler(async ({ input }) => {
    await reorderChannels(input.id, input.ids);
  });

/** What the user has seen in a channel, so its count can clear. */
const seenChannelRoute = base
  .input(z.object({ id: TaskIdSchema, sessionId: StoreId.SessionSchema }))
  .handler(async ({ input }) => {
    await markChannelSeen(input.id, input.sessionId);
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

/** What the conversation asks its window to open, as it asks. */
const open = base
  .input(z.object({ id: TaskIdSchema }))
  .output(
    eventIterator(
      z.union([
        z.object({
          kind: z.literal("page"),
          requestId: z.string(),
          url: z.string(),
        }),
        z.object({ kind: z.literal("path"), mount: z.string() }),
      ]),
    ),
  )
  .handler(async function* ({ input, signal }) {
    for await (const event of publisher.subscribe("orchestrator.open", {
      signal,
    })) {
      if (event.id === input.id) {
        yield event.target;
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
  channels: {
    archive: archiveChannelRoute,
    create: createChannelRoute,
    list: listChannelsRoute,
    reorder: reorderChannelsRoute,
    seen: seenChannelRoute,
    update: updateChannelRoute,
  },
  children,
  childStatus,
  ensure,
  events: { open },
  opened,
  setActiveTab,
};
