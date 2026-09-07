import { eventIterator } from "@orpc/server";
import { z } from "zod";

import { getTask } from "../../lib/get-tasks";
import {
  isWorking,
  latestStep,
  orchestratorActivity,
  OrchestratorActivitySchema,
} from "../../lib/orchestrator/activity";
import {
  CHANNEL_NAME_MAX,
  channelName,
  channelStandings,
  createChannel,
  markChannelSeen,
} from "../../lib/orchestrator/channels";
import { listChildTasks } from "../../lib/orchestrator/children";
import { ensureOrchestrator } from "../../lib/orchestrator/ensure";
import {
  ensureHomeFolder,
  ensureOutputFolder,
} from "../../lib/orchestrator/output-folder";
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
  // With each one's folder on disk: what a link into `/tasks/<id>` opens.
  .output(TaskSchema.extend({ dir: z.string() }).array())
  .handler(async ({ input }) => {
    const tasks = await listChildTasks(input.id);
    return tasks.map((task) => ({ ...task, dir: taskDir(task.id) }));
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
  createdAt: z.number(),
  id: StoreId.SessionSchema,
  name: z.string(),
  unread: z.number(),
  updatedAt: z.number(),
});

/** The conversation's channels, in the order they were made. */
const listChannelsRoute = base
  .input(z.object({ id: TaskIdSchema }))
  .output(ChannelSchema.array())
  .handler(({ input }) => channelStandings(input.id));

/** Makes a channel: a session of the same conversation under a name. */
const createChannelRoute = base
  .input(
    z.object({
      id: TaskIdSchema,
      name: z
        .string()
        .min(1)
        .max(CHANNEL_NAME_MAX * 2),
    }),
  )
  .output(ChannelSchema.omit({ unread: true, updatedAt: true }))
  .handler(({ input }) => createChannel(input.id, channelName(input.name)));

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
        z.object({ kind: z.literal("page"), url: z.string() }),
        z.object({ kind: z.literal("file"), mount: z.string() }),
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

export const orchestrator = {
  activity,
  channels: {
    create: createChannelRoute,
    list: listChannelsRoute,
    seen: seenChannelRoute,
  },
  children,
  childStatus,
  ensure,
  events: { open },
  setActiveTab,
};
