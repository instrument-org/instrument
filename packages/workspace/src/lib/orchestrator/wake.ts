import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import ms from "ms";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { getTasks } from "../get-tasks";
import { filesNamedIn } from "../parse-files-block";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { getTaskSettings, recordTaskActivity } from "../task-settings";
import { getTaskUsageSummary } from "../usage-summary";
import { getWorkspaceConfig } from "../workspace-config";
import { isWorking, latestStep, leftRunning, turnStartedAt } from "./activity";
import { threadOfTask } from "./attribution";
import { taskFolderHoldings } from "./folder-holdings";
import { lastAssistantText, latestOrNewSessionId } from "./latest-session";
import {
  mountsOf,
  translateMountPaths,
  translateTaskFolderPaths,
} from "./mount-paths";
import { endedWithoutWords } from "./standing";
import { activitiesSince } from "./steps";
import { WAKE_SUMMARY_MAX_LENGTH } from "./wake-summary";

/** What a wake carries: the part that starts the orchestrator's turn. */
export type WakePart =
  | { data: SessionMessageDataPart.AppEventDataPart; type: "data-appEvent" }
  | { data: SessionMessageDataPart.TaskEventDataPart; type: "data-taskEvent" };

type TaskEvent = SessionMessageDataPart.TaskEventDataPart["events"][number];

/**
 * How long after a child finishes before the orchestrator is woken. Long enough
 * that two children finishing together arrive as one note naming both, short
 * enough that a single finish still feels immediate.
 */
const WAKE_DEBOUNCE_MS = 1500;

/**
 * How long a task works before the orchestrator is told it is still at it,
 * and then again after as long again. Long enough that ordinary tasks never
 * trip it; short enough that one lost in a website is caught before it has
 * spent a quarter of an hour.
 */
const OVERDUE_AFTER_MS = ms("4 minutes");
const OVERDUE_CHECK_MS = ms("30 seconds");

/** How many of a turn's activities an overdue note carries, latest last. */
const OVERDUE_STEPS = 6;

/** When each child was last reported overdue, so the note comes once per stretch. */
const overdueReportedAt = new Map<TaskId, number>();

/**
 * Wakes the conversation asked for itself, one per child: a timer, and what
 * it was told to wait. A task with one pending is off the clock above, since
 * the conversation has said when it wants to look.
 */
const askedWakes = new Map<
  TaskId,
  { afterMs: number; timer: NodeJS.Timeout }
>();

/**
 * Children the orchestrator itself told to stop. The turn that ends is the
 * one it ended, so there is nothing to wake it about; the next finish after
 * that is news again.
 */
const stoppedByOrchestrator = new Set<TaskId>();

/**
 * Wakes the conversation about one of its tasks after a delay of its choosing,
 * with the same note the clock sends. One per task: asking again moves the
 * wake. Dropped when the task finishes first, since the finish is the news.
 */
export function askWake({
  afterMs,
  orchestratorId,
  taskId,
  workspaceRef,
}: {
  afterMs: number;
  orchestratorId: TaskId;
  taskId: TaskId;
  workspaceRef: WorkspaceActorRef;
}) {
  cancelAskedWake(taskId);
  const timer = setTimeout(() => {
    askedWakes.delete(taskId);
    deliverAskedWake({ afterMs, orchestratorId, taskId }, workspaceRef).catch(
      (error: unknown) => {
        getWorkspaceConfig().captureException(error);
      },
    );
  }, afterMs);
  timer.unref();
  askedWakes.set(taskId, { afterMs, timer });
}

/** Forgets a wake the conversation asked for; true when there was one. */
export function cancelAskedWake(taskId: TaskId): boolean {
  const asked = askedWakes.get(taskId);
  if (!asked) {
    return false;
  }
  clearTimeout(asked.timer);
  askedWakes.delete(taskId);
  return true;
}

export function expectStop(taskId: TaskId) {
  stoppedByOrchestrator.add(taskId);
}

const pending = new Map<
  TaskId,
  { events: Map<TaskId, TaskEvent>; timer: NodeJS.Timeout }
>();

/**
 * Wakes an orchestrator when a task it created finishes a turn.
 *
 * One subscriber over the session-done topic for the life of the process. A
 * finished session that belongs to a child of an orchestrator becomes a
 * `data-taskEvent` part on a text-less user message in the orchestrator's
 * session, which starts a turn there if it is idle and queues behind the
 * current one if it is not, the same as anything the user types.
 */
export function startOrchestratorWake(workspaceRef: WorkspaceActorRef): void {
  void (async () => {
    for await (const payload of publisher.subscribe("session.done")) {
      try {
        await onSessionDone(payload, workspaceRef);
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
  // The clock on every child: a task that has worked past the mark wakes its
  // orchestrator with where it is, so a task lost in the weeds is found by
  // the agent rather than by the person.
  const timer = setInterval(() => {
    checkOverdue(workspaceRef).catch((error: unknown) => {
      getWorkspaceConfig().captureException(error);
    });
  }, OVERDUE_CHECK_MS);
  timer.unref();
}

/**
 * Wake every orchestrator with the same part: what an app event does, since
 * the user acted on the app rather than on any one conversation. An
 * orchestrator that has never been messaged has no model to wake with and
 * nothing waiting on the news, so it is left alone. `threadOf` names the
 * thread to wake each one in; none means its newest.
 */
export async function wakeOrchestrators(
  part: WakePart,
  workspaceRef: WorkspaceActorRef,
  threadOf?: (orchestratorId: TaskId) => Promise<StoreId.Session | undefined>,
): Promise<void> {
  const { tasks } = await getTasks(getWorkspaceConfig());
  for (const task of tasks) {
    if (task.kind !== "orchestrator") {
      continue;
    }
    const state = await getTaskState(taskDir(task.id));
    if (!state.selectedModelURI) {
      continue;
    }
    await wakeWith(task.id, part, workspaceRef, await threadOf?.(task.id));
  }
}

async function checkOverdue(workspaceRef: WorkspaceActorRef) {
  const workspaceConfig = getWorkspaceConfig();
  const { tasks } = await getTasks(workspaceConfig);
  const now = Date.now();
  for (const task of tasks) {
    const parentTaskId = task.parentTaskId;
    if (parentTaskId === undefined || !isWorking(task.id)) {
      overdueReportedAt.delete(task.id);
      continue;
    }
    // The conversation said when it wants to look; the clock stays quiet.
    if (askedWakes.has(task.id)) {
      continue;
    }
    const reportedAt = overdueReportedAt.get(task.id);
    const turnStart = await turnStartedAt(task.id);
    const startedAt = reportedAt ?? turnStart?.getTime();
    if (startedAt === undefined || now - startedAt < OVERDUE_AFTER_MS) {
      continue;
    }
    overdueReportedAt.set(task.id, now);
    schedule(
      parentTaskId,
      await stillWorkingEvent({
        orchestratorId: parentTaskId,
        taskId: task.id,
        title: task.title,
        turnStart,
      }),
      workspaceRef,
    );
  }
}

async function deliver(
  orchestratorId: TaskId,
  events: TaskEvent[],
  workspaceRef: WorkspaceActorRef,
) {
  // A task reports into the thread it was filed from, so a batch that spans
  // threads becomes one wake each rather than one message in whichever
  // thread happens to be newest.
  const byThread = new Map<string, TaskEvent[]>();
  const sessions = new Map<string, StoreId.Session | undefined>();
  for (const event of events) {
    const sessionId = await threadOfTask({
      orchestratorTaskId: orchestratorId,
      taskId: event.taskId,
    });
    const key = sessionId ?? "";
    sessions.set(key, sessionId);
    byThread.set(key, [...(byThread.get(key) ?? []), event]);
  }
  for (const [key, threadEvents] of byThread) {
    await wakeWith(
      orchestratorId,
      { data: { events: threadEvents }, type: "data-taskEvent" },
      workspaceRef,
      sessions.get(key),
    );
  }
}

/**
 * The note the conversation asked for, if the task is still at work when the
 * time comes. A task that finished first already woke it; one it stopped
 * itself is not news either. The clock starts over from here, so the asked
 * wake is not followed by the clock's own note a moment later.
 */
async function deliverAskedWake(
  {
    afterMs,
    orchestratorId,
    taskId,
  }: { afterMs: number; orchestratorId: TaskId; taskId: TaskId },
  workspaceRef: WorkspaceActorRef,
) {
  if (!isWorking(taskId)) {
    return;
  }
  const settings = await getTaskSettings(taskDir(taskId));
  overdueReportedAt.set(taskId, Date.now());
  schedule(
    orchestratorId,
    {
      ...(await stillWorkingEvent({
        orchestratorId,
        taskId,
        title: settings?.name ?? taskId,
        turnStart: await turnStartedAt(taskId),
      })),
      askedAfterMs: afterMs,
    },
    workspaceRef,
  );
}

/**
 * What a task said, in the paths the conversation that started it reads. The
 * two hold the same folders under names of their own (see mount-paths.ts), and
 * a note is composed for the conversation rather than for the task.
 */
async function inOrchestratorPaths(
  text: string | undefined,
  {
    orchestratorTaskId,
    taskId,
  }: { orchestratorTaskId: TaskId; taskId: TaskId },
): Promise<string | undefined> {
  if (text === undefined) {
    return undefined;
  }
  return translateTaskFolderPaths(
    translateMountPaths(
      text,
      await mountsOf(taskId),
      await mountsOf(orchestratorTaskId),
    ),
    taskId,
  );
}

async function onSessionDone(
  {
    id,
    parentSessionId,
    sessionId,
  }: {
    id: TaskId;
    parentSessionId: StoreId.Session | undefined;
    sessionId: StoreId.Session;
  },
  workspaceRef: WorkspaceActorRef,
) {
  // A nested sub-agent session ending inside a task is that task's business,
  // not a task finishing.
  if (parentSessionId) {
    return;
  }
  const childSettings = await getTaskSettings(taskDir(id));
  const orchestratorId = childSettings?.parentTaskId;
  if (!orchestratorId) {
    return;
  }
  const orchestratorSettings = await getTaskSettings(taskDir(orchestratorId));
  if (orchestratorSettings?.kind !== "orchestrator") {
    return;
  }
  cancelAskedWake(id);
  if (stoppedByOrchestrator.delete(id)) {
    return;
  }

  const usage = await getTaskUsageSummary(id);
  // Read as the turn ends rather than at delivery, a debounce later: a process
  // that exits in between was the task's own doing and is not news.
  const running = leftRunning(id);
  const said = await lastAssistantText({
    maxLength: WAKE_SUMMARY_MAX_LENGTH,
    sessionId,
    taskId: id,
  });
  // A turn with no words ended on a stop, the step limit, or a model error,
  // and the note has to say which: the orchestrator continues one of those
  // with `task send`, and leaves one the user stopped alone.
  const ending =
    said === undefined ? await endedWithoutWords(id, sessionId) : undefined;
  const summary = await inOrchestratorPaths(said, {
    orchestratorTaskId: orchestratorId,
    taskId: id,
  });
  // What the task said it made, read from its receipt once the paths in it
  // are the orchestrator's. The note carries the receipt itself; this is for
  // the card, which draws the files as chips.
  const files = summary === undefined ? [] : filesNamedIn(summary);
  schedule(
    orchestratorId,
    {
      activeMs: usage.activeMs,
      ...(ending ? { ended: ending.line } : {}),
      ...(files.length > 0 ? { files } : {}),
      holds: await taskFolderHoldings(id),
      ...(running.length > 0 ? { running } : {}),
      status: ending?.failed ? "error" : "done",
      summary,
      taskId: id,
      title: childSettings.name,
      tokens: usage.inputTokens + usage.outputTokens,
    },
    workspaceRef,
  );
}

function schedule(
  orchestratorId: TaskId,
  event: TaskEvent,
  workspaceRef: WorkspaceActorRef,
) {
  const existing = pending.get(orchestratorId);
  if (existing) {
    clearTimeout(existing.timer);
  }
  const events = existing?.events ?? new Map<TaskId, TaskEvent>();
  events.set(event.taskId, event);
  const timer = setTimeout(() => {
    pending.delete(orchestratorId);
    deliver(orchestratorId, [...events.values()], workspaceRef).catch(
      (error: unknown) => {
        getWorkspaceConfig().captureException(error);
      },
    );
  }, WAKE_DEBOUNCE_MS);
  pending.set(orchestratorId, { events, timer });
}

/**
 * Where a working task stands: how long and how much so far, the activities
 * it set this turn, and what it has written. The two things that tell a task
 * doing deep work apart from one that is lost, which its latest step alone
 * does not.
 */
async function stillWorkingEvent({
  orchestratorId,
  taskId,
  title,
  turnStart,
}: {
  orchestratorId: TaskId;
  taskId: TaskId;
  title: string;
  turnStart: Date | undefined;
}): Promise<TaskEvent> {
  const usage = await getTaskUsageSummary(taskId);
  const paths = { orchestratorTaskId: orchestratorId, taskId };
  const activities = await activitiesSince(taskId, turnStart ?? new Date());
  const steps = await Promise.all(
    activities
      .slice(-OVERDUE_STEPS)
      .map((step) => inOrchestratorPaths(step, paths)),
  );
  return {
    activeMs: usage.activeMs,
    cachedTokens: usage.inputTokenDetails.cacheReadTokens,
    holds: await taskFolderHoldings(taskId),
    status: "overdue",
    steps: steps.filter((step) => step !== undefined),
    summary: await inOrchestratorPaths(await latestStep(taskId), paths),
    taskId,
    title,
    tokens: usage.inputTokens + usage.outputTokens,
  };
}

async function wakeWith(
  orchestratorId: TaskId,
  part: WakePart,
  workspaceRef: WorkspaceActorRef,
  /** The thread to wake in; the newest one when a caller has no thread. */
  threadId?: StoreId.Session,
) {
  const workspaceConfig = getWorkspaceConfig();
  const state = await getTaskState(taskDir(orchestratorId));
  if (!state.selectedModelURI) {
    throw new Error(
      `Orchestrator ${orchestratorId} has no model to wake with; it has never been messaged.`,
    );
  }
  const modelResult = await fetchModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelURI: AIGatewayModelURI.Schema.parse(state.selectedModelURI),
  });
  if (!modelResult.ok) {
    throw modelResult.error;
  }

  const session = await latestOrNewSessionId(orchestratorId);
  if (session.isErr()) {
    throw session.error;
  }
  const sessionId = threadId ?? session.value;

  const createdAt = new Date();
  const messageId = StoreId.newMessageId();
  const message: SessionMessage.UserWithParts = {
    id: messageId,
    metadata: { createdAt, sessionId },
    parts: [
      {
        ...part,
        metadata: {
          createdAt,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
      },
    ],
    role: "user",
  };

  // Written now, so the note shows in the conversation the moment it fires,
  // whatever the orchestrator is in the middle of.
  const written = await Store.saveMessageWithParts(message, orchestratorId);
  if (written.isErr()) {
    throw new Error(written.error.message);
  }
  workspaceRef.send({
    type: "addMessage",
    value: {
      agentName: "instrument",
      id: orchestratorId,
      message,
      model: modelResult.value,
      saved: true,
      sessionId,
    },
  });
  await recordTaskActivity(orchestratorId);
}
