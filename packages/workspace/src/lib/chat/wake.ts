import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import ms from "ms";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { type TaskId } from "../../schemas/task-id";
import { filesNamedIn } from "../parse-files-block";
import { needsNamedIn, withoutNeedsFences } from "../parse-needs-block";
import { owningChat, resolveChat, sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { getTaskSettings, recordTaskActivity } from "../task-settings";
import { getTaskUsageSummary } from "../usage-summary";
import { getWorkspaceConfig } from "../workspace-config";
import { isWorking, latestStep, leftRunning, turnStartedAt } from "./activity";
import { chatOfTask } from "./attribution";
import { listChatIds } from "./chat-records";
import { listChildTasks } from "./children";
import { taskFolderHoldings } from "./folder-holdings";
import { stepInFlight } from "./in-flight";
import {
  cutForNote,
  lastAssistantText,
  latestOrNewSessionId,
} from "./latest-session";
import {
  mountsOf,
  translateMountPaths,
  translateTaskFolderPaths,
} from "./mount-paths";
import { endedWithoutWords } from "./standing";
import { trajectorySince } from "./steps";
import { replacesPendingEvent } from "./wake-event";
import { WAKE_SUMMARY_MAX_LENGTH } from "./wake-summary";
import { type ChatId } from "../../schemas/chat-id";

/** What a wake carries: the part that starts the chat's turn. */
export type WakePart =
  | { data: SessionMessageDataPart.AppEventDataPart; type: "data-appEvent" }
  | { data: SessionMessageDataPart.TaskEventDataPart; type: "data-taskEvent" };

type TaskEvent = SessionMessageDataPart.TaskEventDataPart["events"][number];

/**
 * How long after a child finishes before the chat is woken. Long enough
 * that two children finishing together arrive as one note naming both, short
 * enough that a single finish still feels immediate.
 */
const WAKE_DEBOUNCE_MS = 1500;

/**
 * How long a task works before the chat is told it is still at it,
 * and then again after as long again. Long enough that ordinary tasks never
 * trip it; short enough that one lost in a website is caught before it has
 * spent a quarter of an hour.
 */
const OVERDUE_AFTER_MS = ms("4 minutes");
const OVERDUE_CHECK_MS = ms("30 seconds");

/** How many of a turn's steps an overdue note carries, latest last. */
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
 * Children the chat itself told to stop. The turn that ends is the
 * one it ended, so there is nothing to wake it about; the next finish after
 * that is news again.
 */
const stoppedByChat = new Set<TaskId>();

/**
 * Wakes the conversation about one of its tasks after a delay of its choosing,
 * with the same note the clock sends. One per task: asking again moves the
 * wake. Dropped when the task finishes first, since the finish is the news.
 */
export function askWake({
  afterMs,
  chatId,
  taskId,
  workspaceRef,
}: {
  afterMs: number;
  chatId: TaskId;
  taskId: TaskId;
  workspaceRef: WorkspaceActorRef;
}) {
  cancelAskedWake(taskId);
  const timer = setTimeout(() => {
    askedWakes.delete(taskId);
    deliverAskedWake({ afterMs, chatId, taskId }, workspaceRef).catch(
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
  stoppedByChat.add(taskId);
}

const pending = new Map<
  TaskId,
  { events: Map<TaskId, TaskEvent>; timer: NodeJS.Timeout }
>();

/**
 * Whether a task's finish is waiting out the debounce before its wake is
 * written. The chat it was filed from is still at work in that gap: its task
 * has stopped and its own agent has not started on the news yet.
 */
export function hasPendingWake(chatId: TaskId, taskId: TaskId) {
  return pending.get(chatId)?.events.has(taskId) ?? false;
}

/**
 * Wakes a chat when a task it created finishes a turn.
 *
 * One subscriber over the session-done topic for the life of the process. A
 * finished session that belongs to a child of a chat becomes a
 * `data-taskEvent` part on a text-less user message in the chat's
 * session, which starts a turn there if it is idle and queues behind the
 * current one if it is not, the same as anything the user types.
 */
export function startChatWake(workspaceRef: WorkspaceActorRef): void {
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
  // chat with where it is, so a task lost in the weeds is found by
  // the agent rather than by the person.
  const timer = setInterval(() => {
    checkOverdue(workspaceRef).catch((error: unknown) => {
      getWorkspaceConfig().captureException(error);
    });
  }, OVERDUE_CHECK_MS);
  timer.unref();
}

/**
 * Wakes one chat with an app's event: the one the app was asked for in, or,
 * for an app nobody asked for, the newest chat that has run, since the user
 * acted on the app rather than on any one conversation. A chat that has never
 * been messaged has no model to wake with and nothing waiting on the news.
 */
export async function wakeChatForApp(
  part: WakePart,
  workspaceRef: WorkspaceActorRef,
  asked: ChatId | undefined,
): Promise<void> {
  // The chat that asked, when it is still there, and then the newest first,
  // so an event for a chat since deleted still reaches someone.
  const candidates = [
    ...(asked && resolveChat(asked) ? [asked] : []),
    ...listChatIds()
      .toReversed()
      .filter((id) => id !== asked),
  ];
  for (const chatId of candidates) {
    const state = await getTaskState(taskDir(chatId));
    if (state.selectedModelURI) {
      await wakeWith(chatId, part, workspaceRef, sessionOfChat(chatId));
      return;
    }
  }
}

async function checkOverdue(workspaceRef: WorkspaceActorRef) {
  const now = Date.now();
  // Only a chat's task reports in, and only one at work is read.
  const working = (
    await Promise.all(
      listChatIds().map((chatId) => listChildTasks(chatId, isWorking)),
    )
  ).flat();
  const workingIds = new Set(working.map((task) => task.id));
  for (const id of overdueReportedAt.keys()) {
    if (!workingIds.has(id)) {
      overdueReportedAt.delete(id);
    }
  }
  for (const task of working) {
    const { chatId } = task;
    if (chatId === undefined) {
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
    const event = await stillWorkingEvent({
      chatId,
      taskId: task.id,
      title: task.title,
      turnStart,
    });
    // The note took several reads to compose; a task that finished meanwhile
    // has already woken the chat with its finish.
    if (!isWorking(task.id)) {
      continue;
    }
    schedule(chatId, event, workspaceRef);
  }
}

async function deliver(
  chatId: TaskId,
  events: TaskEvent[],
  workspaceRef: WorkspaceActorRef,
) {
  // A task reports into the chat it was filed from, so a batch that spans
  // chats becomes one wake each rather than one message in whichever
  // chat happens to be newest.
  const byChat = new Map<string, TaskEvent[]>();
  const sessions = new Map<string, StoreId.Session | undefined>();
  for (const event of events) {
    const sessionId = chatOfTask(event.taskId);
    const key = sessionId ?? "";
    sessions.set(key, sessionId);
    byChat.set(key, [...(byChat.get(key) ?? []), event]);
  }
  for (const [key, chatEvents] of byChat) {
    await wakeWith(
      chatId,
      { data: { events: chatEvents }, type: "data-taskEvent" },
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
    chatId,
    taskId,
  }: { afterMs: number; chatId: TaskId; taskId: TaskId },
  workspaceRef: WorkspaceActorRef,
) {
  if (!isWorking(taskId)) {
    return;
  }
  const settings = await getTaskSettings(taskDir(taskId));
  overdueReportedAt.set(taskId, Date.now());
  const event = await stillWorkingEvent({
    chatId,
    taskId,
    title: settings?.name ?? taskId,
    turnStart: await turnStartedAt(taskId),
  });
  if (!isWorking(taskId)) {
    return;
  }
  schedule(chatId, { ...event, askedAfterMs: afterMs }, workspaceRef);
}

/**
 * What a task said, in the paths the conversation that started it reads. The
 * two hold the same folders under names of their own (see mount-paths.ts), and
 * a note is composed for the conversation rather than for the task.
 */
async function inChatPaths(
  text: string | undefined,
  { chatId, taskId }: { chatId: TaskId; taskId: TaskId },
): Promise<string | undefined> {
  if (text === undefined) {
    return undefined;
  }
  return translateTaskFolderPaths(
    translateMountPaths(text, await mountsOf(taskId), await mountsOf(chatId)),
    taskId,
  );
}

async function onSessionDone(
  {
    id,
    sessionId,
  }: {
    id: TaskId;
    sessionId: StoreId.Session;
  },
  workspaceRef: WorkspaceActorRef,
) {
  // Only a chat is woken, by a task inside it.
  const chatId = owningChat(id);
  if (!chatId) {
    return;
  }
  cancelAskedWake(id);
  if (stoppedByChat.delete(id)) {
    return;
  }

  const usage = await getTaskUsageSummary(id);
  // Read as the turn ends rather than at delivery, a debounce later: a process
  // that exits in between was the task's own doing and is not news.
  const running = leftRunning(id);
  const said = await lastAssistantText({ sessionId, taskId: id });
  // A turn with no words ended on a stop, the step limit, or a model error,
  // and the note has to say which: the chat continues one of those
  // with `task send`, and leaves one the user stopped alone.
  const ending =
    said === undefined ? await endedWithoutWords(id, sessionId) : undefined;
  const receipt = await inChatPaths(said, {
    chatId,
    taskId: id,
  });
  // What the task said it made, read from the whole receipt once the paths
  // in it are the chat's, before the ceiling cuts it: the fence is
  // the receipt's last lines, and a long receipt would otherwise lose it.
  // The note carries the receipt itself; this is for the card, which draws
  // the files as chips.
  const files = receipt === undefined ? [] : filesNamedIn(receipt);
  // What the task cannot go on without, read the same way and listed apart
  // from its words, so a turn that ended blocked reads as waiting rather than
  // finished and the fence is not said twice.
  const needs = receipt === undefined ? [] : needsNamedIn(receipt);
  const summary =
    receipt === undefined
      ? undefined
      : cutForNote(
          needs.length > 0 ? withoutNeedsFences(receipt) : receipt,
          WAKE_SUMMARY_MAX_LENGTH,
        );
  schedule(
    chatId,
    {
      activeMs: usage.activeMs,
      ...(ending ? { ended: ending.line } : {}),
      ...(files.length > 0 ? { files } : {}),
      holds: await taskFolderHoldings(id),
      ...(needs.length > 0 ? { needs } : {}),
      ...(running.length > 0 ? { running } : {}),
      status: ending?.failed ? "error" : "done",
      summary,
      taskId: id,
      title: (await getTaskSettings(taskDir(id)))?.name ?? id,
      tokens: usage.inputTokens + usage.outputTokens,
    },
    workspaceRef,
  );
}

function schedule(
  chatId: TaskId,
  event: TaskEvent,
  workspaceRef: WorkspaceActorRef,
) {
  const existing = pending.get(chatId);
  if (!replacesPendingEvent(existing?.events.get(event.taskId), event)) {
    return;
  }
  if (existing) {
    clearTimeout(existing.timer);
  }
  const events = existing?.events ?? new Map<TaskId, TaskEvent>();
  events.set(event.taskId, event);
  const timer = setTimeout(() => {
    pending.delete(chatId);
    deliver(chatId, [...events.values()], workspaceRef).catch(
      (error: unknown) => {
        getWorkspaceConfig().captureException(error);
      },
    );
  }, WAKE_DEBOUNCE_MS);
  pending.set(chatId, { events, timer });
}

/**
 * Where a working task stands: how long and how much so far, where it has
 * gone this turn, what it has written, and what the step running now is
 * doing. What tells a task doing deep work apart from one that is lost, which
 * its latest step alone does not.
 */
async function stillWorkingEvent({
  chatId,
  taskId,
  title,
  turnStart,
}: {
  chatId: TaskId;
  taskId: TaskId;
  title: string;
  turnStart: Date | undefined;
}): Promise<TaskEvent> {
  const usage = await getTaskUsageSummary(taskId);
  const paths = { chatId, taskId };
  const trajectory = await trajectorySince(taskId, turnStart ?? new Date());
  const steps = await Promise.all(
    trajectory.slice(-OVERDUE_STEPS).map((step) => inChatPaths(step, paths)),
  );
  return {
    activeMs: usage.activeMs,
    cachedTokens: usage.inputTokenDetails.cacheReadTokens,
    holds: await taskFolderHoldings(taskId),
    inFlight: await stepInFlight(taskId),
    status: "overdue",
    steps: steps.filter((step) => step !== undefined),
    summary: await inChatPaths(await latestStep(taskId), paths),
    taskId,
    title,
    tokens: usage.inputTokens + usage.outputTokens,
  };
}

async function wakeWith(
  chatId: TaskId,
  part: WakePart,
  workspaceRef: WorkspaceActorRef,
  /** The chat to wake in; the newest one when a caller has no chat. */
  chatSessionId?: StoreId.Session,
) {
  const workspaceConfig = getWorkspaceConfig();
  const state = await getTaskState(taskDir(chatId));
  if (!state.selectedModelURI) {
    throw new Error(
      `Chat ${chatId} has no model to wake with; it has never been messaged.`,
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

  const session = await latestOrNewSessionId(chatId);
  if (session.isErr()) {
    throw session.error;
  }
  const sessionId = chatSessionId ?? session.value;

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
  // whatever the chat is in the middle of.
  const written = await Store.saveMessageWithParts(message, chatId);
  if (written.isErr()) {
    throw new Error(written.error.message);
  }
  workspaceRef.send({
    type: "addMessage",
    value: {
      agentName: "instrument",
      id: chatId,
      message,
      model: modelResult.value,
      saved: true,
      sessionId,
    },
  });
  await recordTaskActivity(chatId);
}
