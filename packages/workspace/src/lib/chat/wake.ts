import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import ms from "ms";
import { setTimeout as sleep } from "node:timers/promises";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { heldTabs } from "../held-tabs";
import { filesNamedIn } from "../parse-files-block";
import { needsNamedIn, withoutNeedsFences } from "../parse-needs-block";
import { resolveChat, sessionOfChat, chatDir } from "../record-folders";
import { Store } from "../store";
import { getChatState } from "../chat-record";
import { recordChatActivity } from "../chat-settings";
import { getUsageSummary } from "../usage-summary";
import { getWorkspaceConfig } from "../workspace-config";
import { decodeBrowserTargetId } from "../../types";
import { isWorking, latestStep, leftRunning, turnStartedAt } from "./activity";
import { currentChatApps, setChatAppsBaseline } from "../chat-app-changes";
import { listChatIds } from "./chat-records";
import { childTask, listChildTasks, touchTask } from "./children";
import { stepInFlight } from "./in-flight";
import {
  cutForNote,
  lastAssistantText,
  latestOrNewSessionId,
} from "./latest-session";
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

/**
 * The waits between lookups of a chat's model before a wake gives up on
 * starting its turn, about two minutes in all.
 */
const WAKE_MODEL_RETRY_DELAYS_MS = [
  ms("2 seconds"),
  ms("5 seconds"),
  ms("15 seconds"),
  ms("30 seconds"),
  ms("1 minute"),
];

/** How many of a turn's steps an overdue note carries, latest last. */
const OVERDUE_STEPS = 6;

/** When each task was last reported overdue, by its session, so the note comes once per stretch. */
const overdueReportedAt = new Map<StoreId.Session, number>();

/**
 * Tasks the chat itself told to stop, by their sessions. The turn that ends
 * is the one it ended, so there is nothing to wake it about; the next finish
 * after that is news again.
 */
const stoppedByChat = new Set<StoreId.Session>();

/**
 * Wakes a chat about one of its tasks with an event composed elsewhere,
 * through the same debounce and delivery a finish takes. What the eval
 * harness stands a task's finish in with, without the task doing the work.
 */
export function wakeChatWithTaskEvent(
  chatId: ChatId,
  event: TaskEvent,
  workspaceRef: WorkspaceActorRef,
) {
  schedule(chatId, event, workspaceRef);
}

/** Says a task's turn is ending at the chat's word, by the task's session. */
export function expectStop(sessionId: StoreId.Session) {
  stoppedByChat.add(sessionId);
}

const pending = new Map<
  ChatId,
  { events: Map<string, TaskEvent>; timer: NodeJS.Timeout }
>();

/**
 * Whether any of a chat's tasks has a finish waiting out the debounce before
 * its wake is written. The chat is still at work in that gap: its task has
 * stopped and its own agent has not started on the news yet.
 */
export function hasPendingWake(chatId: ChatId) {
  return (pending.get(chatId)?.events.size ?? 0) > 0;
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
 * Wakes the chat an app was asked for in with the user's answer to that ask:
 * a sign-in finished, a key saved, a decline, a failure. Only that chat, and
 * only while it is still there: a change nobody in a conversation asked
 * for (a disconnect or a removal on the app's page) wakes nothing, and
 * reaches each chat on the next message the user writes there
 * (`detectChatAppChanges`). Waking leaves that chat's baseline at the apps
 * as they now stand, so its next message does not say the same thing again.
 */
export async function wakeChatForApp(
  part: WakePart,
  workspaceRef: WorkspaceActorRef,
  asked: ChatId | undefined,
): Promise<void> {
  if (asked === undefined || !resolveChat(asked)) {
    return;
  }
  const state = await getChatState(chatDir(asked));
  if (!state.selectedModelURI) {
    return;
  }
  const sessionId = sessionOfChat(asked);
  await wakeWith(asked, part, workspaceRef, sessionId);
  if (sessionId !== undefined) {
    const baseline = await setChatAppsBaseline(
      asked,
      sessionId,
      await currentChatApps(),
    );
    if (baseline.isErr()) {
      getWorkspaceConfig().captureException(baseline.error);
    }
  }
}

async function checkOverdue(workspaceRef: WorkspaceActorRef) {
  const now = Date.now();
  // Only a chat's task reports in, and only one at work is read.
  const working = (
    await Promise.all(
      listChatIds().map((chatId) =>
        listChildTasks(chatId, (id) => isWorking(chatId, id)),
      ),
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
    const ref = { sessionId: task.id, chatId };
    const reportedAt = overdueReportedAt.get(task.id);
    const turnStart = await turnStartedAt(ref);
    const startedAt = reportedAt ?? turnStart?.getTime();
    if (startedAt === undefined || now - startedAt < OVERDUE_AFTER_MS) {
      continue;
    }
    overdueReportedAt.set(task.id, now);
    const event = await stillWorkingEvent({
      ...ref,
      handle: task.handle,
      title: task.title,
      turnStart,
    });
    // The note took several reads to compose; a task that finished meanwhile
    // has already woken the chat with its finish.
    if (!isWorking(chatId, task.id)) {
      continue;
    }
    schedule(chatId, event, workspaceRef);
  }
}

async function deliver(
  chatId: ChatId,
  events: TaskEvent[],
  workspaceRef: WorkspaceActorRef,
) {
  // A report is the task's latest activity: the list orders by it, and the
  // chat's line names a task that finished since the user last wrote by it.
  await Promise.all(events.map((event) => touchTask(chatId, event.sessionId)));
  await wakeWith(
    chatId,
    { data: { events }, type: "data-taskEvent" },
    workspaceRef,
    sessionOfChat(chatId),
  );
}

async function onSessionDone(
  {
    id,
    sessionId,
  }: {
    id: ChatId;
    sessionId: StoreId.Session;
  },
  workspaceRef: WorkspaceActorRef,
) {
  // Only a chat is woken, by a task of its own.
  const chatId = resolveChat(id);
  const task = chatId ? await childTask(chatId, sessionId) : undefined;
  if (!chatId || !task) {
    return;
  }
  const ref = { sessionId, chatId };
  // Read as the turn ends rather than at delivery, a debounce later: a process
  // that exits in between was the task's own doing and is not news.
  const running = leftRunning(sessionId);
  // What the task's agent said, never what the chat said before it.
  const said = await lastAssistantText(ref);
  // A turn with no words ended on a stop, the step limit, or a model error,
  // and the note has to say which: the chat continues one of those
  // with `task send`, and leaves one the user stopped alone.
  const ending = said === undefined ? await endedWithoutWords(ref) : undefined;
  // What the task cannot go on without, read the same way and listed apart
  // from its words, so a turn that ended blocked reads as waiting rather than
  // finished and the fence is not said twice.
  const needs = said === undefined ? [] : needsNamedIn(said);
  await touchTask(chatId, sessionId, {
    status: ending?.failed ? "failed" : needs.length > 0 ? "waiting" : "done",
  });
  if (stoppedByChat.delete(sessionId)) {
    return;
  }
  // A chat nobody has written in has no conversation to report to: the eval
  // harness runs a task case in one (`evals/lib/start-run.ts`).
  if (!(await getChatState(chatDir(chatId))).selectedModelURI) {
    return;
  }

  const usage = await getUsageSummary(chatId, { sessionId });
  // The task works in the chat's folder with the chat's folders, so what it
  // said names every path the way the chat reads it.
  const receipt = said;
  // What the task said it made, read from the whole receipt before the
  // ceiling cuts it: the fence is the receipt's last lines, and a long
  // receipt would otherwise lose it. The note carries the receipt itself;
  // this is for the card, which draws the files as chips.
  const files = receipt === undefined ? [] : filesNamedIn(receipt);
  const tabs = await openTabsOf(ref);
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
      handle: task.handle,
      ...(needs.length > 0 ? { needs } : {}),
      ...(running.length > 0 ? { running } : {}),
      status: ending?.failed ? "error" : "done",
      summary,
      sessionId,
      ...(tabs.length > 0 ? { tabs } : {}),
      title: task.title,
      tokens: usage.inputTokens + usage.outputTokens,
    },
    workspaceRef,
  );
}

function schedule(
  chatId: ChatId,
  event: TaskEvent,
  workspaceRef: WorkspaceActorRef,
) {
  const existing = pending.get(chatId);
  if (!replacesPendingEvent(existing?.events.get(event.sessionId), event)) {
    return;
  }
  if (existing) {
    clearTimeout(existing.timer);
  }
  const events = existing?.events ?? new Map<string, TaskEvent>();
  events.set(event.sessionId, event);
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
 * The window's tabs a task held that are still open, by the id `tab` takes:
 * a result the task left on a page is in one of these, and nowhere in the
 * task's own transcript.
 */
async function openTabsOf({
  sessionId,
  chatId,
}: {
  sessionId: StoreId.Session;
  chatId: ChatId;
}): Promise<NonNullable<TaskEvent["tabs"]>> {
  const { browser } = getWorkspaceConfig();
  return (await heldTabs(chatId, sessionId)).flatMap((tab) => {
    const decoded = decodeBrowserTargetId(tab.id);
    if (!decoded || !browser.getTargetMeta(tab.id)) {
      return [];
    }
    const url = browser.getTargetUrl(tab.id);
    return [
      {
        id: decoded.sessionId,
        openedBy: tab.openedBy,
        ...(url === undefined ? {} : { url }),
      },
    ];
  });
}

/**
 * Where a working task stands: how long and how much so far, where it has
 * gone this turn, what it has written, and what the step running now is
 * doing. What tells a task doing deep work apart from one that is lost, which
 * its latest step alone does not.
 */
async function stillWorkingEvent({
  handle,
  sessionId,
  chatId,
  title,
  turnStart,
}: {
  handle: string;
  sessionId: StoreId.Session;
  chatId: ChatId;
  title: string;
  turnStart: Date | undefined;
}): Promise<TaskEvent> {
  const ref = { sessionId, chatId };
  const usage = await getUsageSummary(chatId, { sessionId });
  const trajectory = await trajectorySince(ref, turnStart ?? new Date());
  return {
    activeMs: usage.activeMs,
    cachedTokens: usage.inputTokenDetails.cacheReadTokens,
    handle,
    inFlight: await stepInFlight(ref),
    status: "overdue",
    steps: trajectory.slice(-OVERDUE_STEPS),
    sessionId,
    summary: await latestStep(ref),
    title,
    tokens: usage.inputTokens + usage.outputTokens,
  };
}

async function wakeWith(
  chatId: ChatId,
  part: WakePart,
  workspaceRef: WorkspaceActorRef,
  /** The chat to wake in; the newest one when a caller has no chat. */
  chatSessionId?: StoreId.Session,
) {
  const state = await getChatState(chatDir(chatId));
  if (!state.selectedModelURI) {
    throw new Error(
      `Chat ${chatId} has no model to wake with; it has never been messaged.`,
    );
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

  // Looked up after the note is written, so a model the chat cannot resolve
  // yet still leaves the news in the conversation, where the user's next
  // message carries it to the agent.
  const model = await wakeModel(
    AIGatewayModelURI.Schema.parse(state.selectedModelURI),
  );
  workspaceRef.send({
    type: "addMessage",
    value: {
      id: chatId,
      message,
      model,
      saved: true,
      sessionId,
    },
  });
  await recordChatActivity(chatId);
}

/**
 * The chat's model, asked for again after each wait in
 * `WAKE_MODEL_RETRY_DELAYS_MS` while the lookup fails, since a provider's
 * catalog can leave a model out for a moment and list it again.
 */
async function wakeModel(modelURI: AIGatewayModelURI.Type) {
  const workspaceConfig = getWorkspaceConfig();
  const lookUp = () =>
    fetchModel({
      captureException: workspaceConfig.captureException,
      configs: workspaceConfig.getAIProviderConfigs(),
      modelCache: workspaceConfig.modelCache,
      modelURI,
    });
  let result = await lookUp();
  for (const delayMs of WAKE_MODEL_RETRY_DELAYS_MS) {
    if (result.ok) {
      break;
    }
    await sleep(delayMs);
    result = await lookUp();
  }
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}
