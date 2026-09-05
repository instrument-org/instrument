import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import ms from "ms";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { createSession } from "../create-session";
import { getTasks } from "../get-tasks";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { getTaskSettings, recordTaskActivity } from "../task-settings";
import { getTaskUsageSummary } from "../usage-summary";
import { getWorkspaceConfig } from "../workspace-config";
import { isWorking, latestStep, turnStartedAt } from "./activity";
import { lastAssistantText, latestSessionId } from "./latest-session";

type TaskEvent = SessionMessageDataPart.TaskEventDataPart["events"][number];

/**
 * How long after a child finishes before the orchestrator is woken. Long enough
 * that two children finishing together arrive as one note naming both, short
 * enough that a single finish still feels immediate.
 */
const WAKE_DEBOUNCE_MS = 1500;

/** The most of a child's last words that travel in the note. */
const SUMMARY_MAX_LENGTH = 400;

/**
 * How long a task works before the orchestrator is told it is still at it,
 * and then again after as long again. Long enough that ordinary tasks never
 * trip it; short enough that one lost in a website is caught before it has
 * spent a quarter of an hour.
 */
const OVERDUE_AFTER_MS = ms("4 minutes");
const OVERDUE_CHECK_MS = ms("30 seconds");

/** When each child was last reported overdue, so the note comes once per stretch. */
const overdueReportedAt = new Map<TaskId, number>();

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
    const reportedAt = overdueReportedAt.get(task.id);
    const turnStart =
      reportedAt === undefined ? await turnStartedAt(task.id) : undefined;
    const startedAt = reportedAt ?? turnStart?.getTime();
    if (startedAt === undefined || now - startedAt < OVERDUE_AFTER_MS) {
      continue;
    }
    const usage = await getTaskUsageSummary(task.id);
    overdueReportedAt.set(task.id, now);
    schedule(
      parentTaskId,
      {
        activeMs: usage.activeMs,
        status: "overdue",
        summary: await latestStep(task.id),
        taskId: task.id,
        title: task.title,
        tokens: usage.inputTokens + usage.outputTokens,
      },
      workspaceRef,
    );
  }
}

async function deliver(
  orchestratorId: TaskId,
  events: TaskEvent[],
  workspaceRef: WorkspaceActorRef,
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

  const sessionId = await sessionToWake(orchestratorId);

  const createdAt = new Date();
  const messageId = StoreId.newMessageId();
  const message: SessionMessage.UserWithParts = {
    id: messageId,
    metadata: { createdAt, sessionId },
    parts: [
      {
        data: { events },
        metadata: {
          createdAt,
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-taskEvent",
      },
    ],
    role: "user",
  };

  workspaceRef.send({
    type: "addMessage",
    value: {
      agentName: "instrument",
      id: orchestratorId,
      message,
      model: modelResult.value,
      sessionId,
    },
  });
  await recordTaskActivity(orchestratorId);
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

  const usage = await getTaskUsageSummary(id);
  schedule(
    orchestratorId,
    {
      activeMs: usage.activeMs,
      status: "done",
      summary: await lastAssistantText({
        maxLength: SUMMARY_MAX_LENGTH,
        sessionId,
        taskId: id,
      }),
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

async function sessionToWake(taskId: TaskId): Promise<StoreId.Session> {
  const newest = await latestSessionId(taskId);
  if (newest.isErr()) {
    throw newest.error;
  }
  if (newest.value) {
    return newest.value;
  }
  const created = await createSession({
    sessionId: StoreId.newSessionId(),
    taskId,
  });
  if (created.isErr()) {
    throw created.error;
  }
  return created.value.id;
}
