import { AIGatewayModelURI, fetchModel } from "@instrument-org/ai-gateway";
import ms from "ms";
import { setTimeout as sleep } from "node:timers/promises";

import { INTERRUPTED_TOOL_CALL_ERROR_TEXT } from "../../constants";
import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { ChatWrites } from "../chat-writes";
import { type Ask } from "../../schemas/chat-state";
import { type SessionMessage } from "../../schemas/session/message";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { type StopNotice, type Stopper } from "../../schemas/stop-notice";
import { StoreId } from "../../schemas/store-id";
import { closePagesWithNoTab, heldTabs, returnTabsToChat } from "../held-tabs";
import {
  agentPathOfFileUrl,
  agentSpellingOfFileUrls,
  isLocalAddress,
} from "../local-page-address";
import { filesNamedIn } from "../parse-files-block";
import { needsNamedIn, withoutNeedsFences } from "../parse-needs-block";
import { openAsksOf } from "./open-asks";
import { resolveChat, sessionOfChat } from "../record-folders";
import { shellPath } from "../workspace-fs-layout";
import { sessionLayout } from "../session-layout";
import { ChatReads } from "../chat-reads";
import { chatModelURI } from "../chat-settings";
import { getUsageSummary } from "../usage-summary";
import { getCurrentDate } from "../get-current-date";
import { isToolPart } from "../is-tool-part";
import { closeAgentBrowserSessionsForSessions } from "../agent-browser-cleanup";
import { processStopsSettled } from "../background-processes";
import { getWorkspaceConfig } from "../workspace-config";
import {
  isWorking,
  latestStep,
  leftRunning,
  ownMessages,
  turnStartedAt,
} from "./activity";
import { appWakeNote } from "../chat-app-changes";
import { listChatIds } from "./chat-records";
import {
  type ChatTask,
  childTask,
  listChildTasks,
  touchTask,
} from "./children";
import { stepInFlight } from "./in-flight";
import { cutForNote, lastAssistantText } from "./latest-session";
import { appClosedLine, endedWithoutWords } from "./standing";
import { trajectorySince } from "./steps";
import { replacesPendingEvent } from "./wake-event";
import { countOnItsWay } from "./wake-queue";
import { WAKE_SUMMARY_MAX_LENGTH } from "./wake-summary";
import { type ChatId } from "../../schemas/chat-id";

/** What a wake carries: the part that starts the chat's turn. */
export type WakePart =
  | { data: SessionMessageDataPart.AppEventDataPart; type: "data-appEvent" }
  | {
      data: SessionMessageDataPart.PermissionAnswerDataPart;
      type: "data-permissionAnswer";
    }
  | {
      data: SessionMessageDataPart.QuestionAnswerDataPart;
      type: "data-questionAnswer";
    }
  | { data: SessionMessageDataPart.JobEventDataPart; type: "data-jobEvent" }
  | { data: SessionMessageDataPart.SignedInDataPart; type: "data-signedIn" }
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
 * Who stopped a task's working turn, and whether the chat hears of it.
 * The chat's own `instrument task stop` is a step it took, and the user's Stop on the
 * whole chat stops the chat too, so the chat hears of neither. The user
 * stopping one task while the chat carries on is written into the chat as a
 * note, so its agent knows the task did not finish and leaves it stopped,
 * but wakes nothing: the person who stopped it knows already, and the agent
 * reads the note with their next message, the way a quit's note is read.
 */
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

const pending = new Map<
  ChatId,
  {
    events: Map<string, TaskEvent>;
    release: () => void;
    timer: NodeJS.Timeout;
  }
>();

/**
 * Delivers a wake counted as on its way (`countOnItsWay`) from its start
 * until it has reached its session or given up.
 */
async function onItsWay<Value>(
  chatId: ChatId,
  delivery: () => Promise<Value>,
): Promise<Value> {
  const release = countOnItsWay(chatId);
  try {
    return await delivery();
  } finally {
    release();
  }
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
 * (`detectChatAppChanges`). The note also tells every change since the
 * chat was last told of its apps, and carries the apps as they now stand,
 * so that chat's next message does not say the same thing again.
 */
export async function wakeChatForApp(
  events: SessionMessageDataPart.AppEventDataPart["events"],
  workspaceRef: WorkspaceActorRef,
  asked: ChatId,
  {
    notOnCard,
    signIns,
  }: {
    /** For a wake about a card, the apps its call named that never reached it. */
    notOnCard?: SessionMessageDataPart.NotOnCard;
    /** For an app asked for on a card with others, every app on the card as it stands. */
    signIns?: SessionMessageDataPart.SignInProgress;
  } = {},
): Promise<void> {
  if (!resolveChat(asked)) {
    return;
  }
  const sessionId = sessionOfChat(asked);
  if (sessionId === undefined || !(await chatModelURI(asked))) {
    return;
  }
  const note = await appWakeNote({
    chatId: asked,
    events,
    notOnCard,
    sessionId,
    signIns,
  });
  if (note.isErr()) {
    throw note.error;
  }
  await wakeWith(
    asked,
    { data: note.value, type: "data-appEvent" },
    workspaceRef,
  );
}

/**
 * Wakes every session that asked on a card with the person's answer to it,
 * or joins each one's turn at its next step when it is still going: a task's
 * own session for each task that ran into a folder or an app, the chat's when
 * the chat did or asked a question. The wakes run side by side, so one that
 * fails does not hold back the others.
 */
export async function wakeAskers(
  part: Extract<
    WakePart,
    { type: "data-permissionAnswer" | "data-questionAnswer" }
  >,
  workspaceRef: WorkspaceActorRef,
  chatId: ChatId,
  askingSessionIds: StoreId.Session[],
): Promise<void> {
  if (!resolveChat(chatId) || !(await chatModelURI(chatId))) {
    return;
  }
  await Promise.all(
    askingSessionIds.map((sessionId) =>
      wakeWith(chatId, part, workspaceRef, sessionId),
    ),
  );
}

/**
 * Wakes a session, a task's or the chat's own, that waited on the person
 * signing in to Instrument, or joins its turn when it is still going.
 */
export async function wakeSessionForSignIn(
  part: Extract<WakePart, { type: "data-signedIn" }>,
  workspaceRef: WorkspaceActorRef,
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<void> {
  if (!resolveChat(chatId) || !(await chatModelURI(chatId))) {
    return;
  }
  await wakeWith(chatId, part, workspaceRef, sessionId);
}

/**
 * Wakes a session, a task's or the chat's own, with the background processes
 * it left running that have since ended on their own (`job-wake.ts`).
 */
export async function wakeSessionForJobs(
  part: Extract<WakePart, { type: "data-jobEvent" }>,
  workspaceRef: WorkspaceActorRef,
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<void> {
  await wakeWith(chatId, part, workspaceRef, sessionId);
}

/**
 * Ends every task at work as the app quits, and leaves each chat a note
 * naming the tasks the quit cut off and what they had running in the
 * background, which the quit kills next. Run before those processes are
 * killed: their list lives only in this process, and a task whose command
 * dies under it would otherwise go on to its next step. The note starts no
 * turn, since nothing would run it; it is in the conversation for the person
 * to see after relaunch, and reaches the chat's agent with its next turn,
 * the way a chat's own interrupted turn is found then. Each task's row keeps
 * that the app stopped it, which the task list reads.
 */
export async function interruptTasksForQuit(
  workspaceRef: WorkspaceActorRef,
): Promise<void> {
  const { sessionRefsByChatId } = workspaceRef.getSnapshot().context;
  const alive = [...sessionRefsByChatId].flatMap(([chatId, refs]) =>
    refs.flatMap((ref) => {
      const snapshot = ref.getSnapshot();
      return snapshot.hasTag("agent.alive")
        ? [{ chatId, sessionId: snapshot.context.sessionId }]
        : [];
    }),
  );
  const interrupted = await noteTasksInterruptedByQuit(alive);
  for (const task of interrupted) {
    workspaceRef.send({
      type: "stopSessions",
      value: {
        id: task.chatId,
        notice: { by: "app", wakesChat: false },
        reason: "quit",
        sessionId: task.id,
      },
    });
  }
}

/**
 * The record half of {@link interruptTasksForQuit}: settles the call each of
 * these sessions that is a task had in flight as cut off now, marks the task
 * as stopped by the app, and writes its chat the note, one per chat. Returns
 * the tasks among them.
 */
export async function noteTasksInterruptedByQuit(
  sessions: { chatId: ChatId; sessionId: StoreId.Session }[],
): Promise<ChatTask[]> {
  const tasks = (
    await Promise.all(
      sessions.map(({ chatId, sessionId }) => childTask(chatId, sessionId)),
    )
  ).filter((task) => task !== undefined);
  const byChat = new Map<ChatId, ChatTask[]>();
  for (const task of tasks) {
    byChat.set(task.chatId, [...(byChat.get(task.chatId) ?? []), task]);
  }
  await Promise.all(
    [...byChat].map(async ([chatId, chatTasks]) => {
      // Ahead of the note, which says how long each task worked: a call
      // still open has no end, and the run it cut off would be counted
      // without it. The stop that follows finds the call already settled.
      const closedAt = getCurrentDate();
      await Promise.all(
        chatTasks.map((task) => settleCutOffCalls(task, closedAt)),
      );
      const events = await Promise.all(chatTasks.map(interruptedEvent));
      await Promise.all(
        chatTasks.map((task) =>
          touchTask(chatId, task.id, { stoppedBy: "app" }),
        ),
      );
      const sessionId = sessionOfChat(chatId);
      if (sessionId !== undefined) {
        await saveNote(chatId, sessionId, {
          data: { events },
          type: "data-taskEvent",
        });
      }
    }),
  );
  return tasks;
}

/**
 * Ends the calls a task's last step left open as cut off by the app closing
 * at `closedAt`, in the words the stop and the next launch's sweep write. A
 * call that settles first is left as it is.
 */
async function settleCutOffCalls(task: ChatTask, closedAt: Date) {
  const ref = { chatId: task.chatId, sessionId: task.id };
  const last = (await ownMessages(ref)).findLast(
    (message) => message.role === "assistant",
  );
  for (const part of last?.parts.filter(isToolPart) ?? []) {
    if (!isOpenCall(part)) {
      continue;
    }
    const written = await ChatWrites.updatePart(
      {
        chatId: task.chatId,
        messageId: part.metadata.messageId,
        partId: part.metadata.id,
        sessionId: part.metadata.sessionId,
      },
      (current) =>
        isToolPart(current) && isOpenCall(current)
          ? // The part union is discriminated by tool type as well as by
            // state, so a spread that moves only the state lands on no
            // member of it; these are the fields an errored call carries.
            ({
              ...current,
              errorText: INTERRUPTED_TOOL_CALL_ERROR_TEXT,
              metadata: { ...current.metadata, endedAt: closedAt },
              state: "output-error",
            } as SessionMessagePart.Type)
          : current,
    );
    if (written.isErr()) {
      getWorkspaceConfig().captureException(written.error);
    }
  }
}

function isOpenCall(part: SessionMessagePart.ToolPart): boolean {
  return part.state === "input-available" || part.state === "input-streaming";
}

/** What the chat is told about one task the quit cut off. */
async function interruptedEvent(task: ChatTask): Promise<TaskEvent> {
  const ref = { sessionId: task.id, chatId: task.chatId };
  const usage = await getUsageSummary(task.chatId, { sessionId: task.id });
  const running = leftRunning(task.id);
  return {
    activeMs: usage.activeMs,
    ended: appClosedLine(await latestStep(ref)),
    handle: task.handle,
    ...(running.length > 0 ? { running } : {}),
    sessionId: task.id,
    status: "done",
    stoppedBy: "app",
    title: task.title,
    tokens: usage.inputTokens + usage.outputTokens,
  };
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
  );
}

async function onSessionDone(
  {
    id,
    notice: stop,
    sessionId,
  }: {
    id: ChatId;
    notice?: StopNotice;
    sessionId: StoreId.Session;
  },
  workspaceRef: WorkspaceActorRef,
) {
  // Only a chat is woken, by a task of its own.
  const chatId = resolveChat(id);
  // Any session's pages that never went anywhere go with its turn, unless
  // its next turn has started, whose pages these may be by now: they go
  // when that one ends.
  if (chatId && !isWorkingAgain(chatId, sessionId)) {
    await closePagesWithNoTab(chatId, sessionId);
  }
  const task = chatId ? await childTask(chatId, sessionId) : undefined;
  if (!chatId || !task) {
    return;
  }
  const ref = { sessionId, chatId };
  // Read as the turn ends rather than at delivery, a debounce later: a process
  // that exits in between was the task's own doing and is not news. A stop of
  // its processes already under way, as the person's Stop of the task sends
  // beside the turn's, is waited out first, so what it ends is not named.
  await processStopsSettled(sessionId);
  const running = leftRunning(sessionId);
  // What the task's agent said, never what the chat said before it.
  const said = await lastAssistantText(ref);
  // A turn with no words ended on a stop, the step limit, or a model error,
  // and the note has to say which: the chat continues one of those
  // with `instrument task send`, and leaves one the user stopped alone.
  const ending = said === undefined ? await endedWithoutWords(ref) : undefined;
  // What the task cannot go on without, read the same way and listed apart
  // from its words, so a turn that ended blocked reads as waiting rather than
  // finished and the fence is not said twice. A card it ran into that is still
  // up is one too, whatever it said; a stopped turn waits on none, since the
  // person's Stop takes it off its cards.
  const needs = [
    ...(said === undefined ? [] : needsNamedIn(said)),
    ...(stop ? [] : (await openAsksOf(chatId, sessionId)).map(cardNeed)),
  ];
  await touchTask(chatId, sessionId, stop ? { stoppedBy: stop.by } : {});
  // The pages it leaves open, read while it still drives them, then given
  // back: a tab has one driver, and a finished task drives nothing.
  const tabs = await openTabsOf(ref);
  await returnTabsToChat(chatId, sessionId);
  // Its agent-browser daemons, which would otherwise idle out on their own
  // clock; a later `instrument task send` starts them again.
  void closeAgentBrowserSessionsForSessions([sessionId]).catch(
    getWorkspaceConfig().captureException,
  );
  if (stop && !stop.wakesChat) {
    return;
  }
  // A chat nobody has written in has no conversation to report to: the eval
  // harness runs a task case in one (`evals/lib/start-run.ts`), with the
  // model its task runs on and nothing said.
  if (!(await hasConversation(chatId))) {
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
  const summary =
    receipt === undefined
      ? undefined
      : cutForNote(
          needs.length > 0 ? withoutNeedsFences(receipt) : receipt,
          WAKE_SUMMARY_MAX_LENGTH,
        );
  const event: TaskEvent = {
    activeMs: usage.activeMs,
    ...(ending
      ? {
          ended:
            stop?.by === "person"
              ? `Stopped by the user${ending.stoppedWhile ? ` while ${ending.stoppedWhile}` : ""}`
              : ending.line,
        }
      : {}),
    ...(files.length > 0 ? { files } : {}),
    handle: task.handle,
    ...(needs.length > 0 ? { needs } : {}),
    ...(ending?.resumable ? { resumable: true } : {}),
    ...(running.length > 0 ? { running } : {}),
    status: ending?.failed ? "error" : "done",
    ...(stop?.by === "person" ? { stoppedBy: stop.by } : {}),
    summary,
    sessionId,
    ...(tabs.length > 0 ? { tabs } : {}),
    title: task.title,
    tokens: usage.inputTokens + usage.outputTokens,
  };
  if (stop?.by === "person") {
    const chatSessionId = sessionOfChat(chatId);
    if (chatSessionId !== undefined) {
      await saveNote(chatId, chatSessionId, {
        data: { events: [event] },
        type: "data-taskEvent",
      });
    }
    return;
  }
  schedule(chatId, event, workspaceRef);
}

/**
 * Whether anything has been said in a chat's own session. A store that
 * cannot be read counts as said, so a hiccup does not swallow a task's news.
 */
async function hasConversation(chatId: ChatId): Promise<boolean> {
  const sessionId = sessionOfChat(chatId);
  if (sessionId === undefined) {
    return false;
  }
  const ids = await ChatReads.messageIds({ chatId, sessionId });
  return ids.isErr() || ids.value.length > 0;
}

/**
 * A card a task's turn ended on, as the note lists what the task cannot go
 * on without: the kind and what it names, in the chat's spelling of a folder,
 * and that the person's answer wakes the task, so the chat need not.
 */
function cardNeed(card: Ask): string {
  if (card.kind === "question") {
    return `question: ${card.question}, on the card in this chat waiting for the person's answer, which wakes it`;
  }
  const what = card.kind === "folder" ? shellPath(card.target) : card.target;
  return `${card.kind}: ${what}, on the card in this chat waiting for the person's answer, which wakes it`;
}

/**
 * Says a task that was waiting on a card was stopped, as the end of a turn
 * stopped the same way does: its row keeps who stopped it, and when the
 * person did, its chat gets the note, which starts no turn. The chat's own
 * `instrument task stop` says so in its output instead. Such a task has no turn for the
 * stop to end, so no session's end says it.
 */
export async function noteTaskStoppedOnCard(
  chatId: ChatId,
  sessionId: StoreId.Session,
  workspaceRef: WorkspaceActorRef,
  by: Extract<Stopper, "agent" | "person">,
): Promise<void> {
  await onSessionDone(
    { id: chatId, notice: { by, wakesChat: by === "person" }, sessionId },
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
  const release = existing?.release ?? countOnItsWay(chatId);
  const timer = setTimeout(() => {
    pending.delete(chatId);
    // Counted for its delivery before the debounce lets go, so the chat
    // never reads as having nothing on its way in between.
    const delivered = onItsWay(chatId, () =>
      deliver(chatId, [...events.values()], workspaceRef),
    );
    release();
    delivered.catch((error: unknown) => {
      getWorkspaceConfig().captureException(error);
    });
  }, WAKE_DEBOUNCE_MS);
  pending.set(chatId, { events, release, timer });
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
  const tabs: NonNullable<TaskEvent["tabs"]> = [];
  for (const tab of await heldTabs(chatId, sessionId)) {
    if (!browser.getTargetMeta(tab.id)) {
      continue;
    }
    const url = browser.getTargetUrl(tab.id);
    tabs.push({
      id: tab.id,
      openedBy: tab.openedBy,
      ...(url === undefined
        ? {}
        : { url: await chatSpellingOfUrl(url, chatId) }),
    });
  }
  return tabs;
}

/**
 * A tab's address as the chat names it: a page on this computer by the
 * chat's own path to it, or as a file outside its folders, never by where it
 * is on disk. A task works in the chat's folder with the chat's folders, so
 * its pages are named the same way.
 */
export async function chatSpellingOfUrl(
  url: string,
  chatId: ChatId,
): Promise<string> {
  if (!isLocalAddress(url)) {
    return url;
  }
  const layout = await sessionLayout({ chatId });
  const agentPath = agentPathOfFileUrl(layout, url);
  if (agentPath === null) {
    return agentSpellingOfFileUrls(url, layout);
  }
  return `file://${agentPath}`;
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

function wakeWith(
  chatId: ChatId,
  part: WakePart,
  workspaceRef: WorkspaceActorRef,
  /** The session to wake: a task that asked, else the chat's own. */
  askingSessionId?: StoreId.Session,
) {
  return onItsWay(chatId, async () => {
    const modelURI = await chatModelURI(chatId);
    if (!modelURI) {
      throw new Error(
        `Chat ${chatId} has no model to wake with; it has never been messaged.`,
      );
    }
    const sessionId = askingSessionId ?? sessionOfChat(chatId);
    if (!sessionId) {
      throw new Error(`${chatId} is not a chat.`);
    }
    const message = await saveNote(chatId, sessionId, part);

    // Looked up after the note is written, so a model the chat cannot resolve
    // yet still leaves the news in the conversation, where the user's next
    // message carries it to the agent.
    const model = await wakeModel(modelURI);
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
  });
}

/**
 * Writes a wake's part as a text-less user message in a session, which shows
 * in the conversation at once and reaches the agent with the session's next
 * turn, whatever starts it.
 */
async function saveNote(
  chatId: ChatId,
  sessionId: StoreId.Session,
  part: WakePart,
): Promise<SessionMessage.UserWithParts> {
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
  const written = await ChatWrites.saveMessageWithParts(message, chatId);
  if (written.isErr()) {
    throw new Error(written.error.message);
  }
  return message;
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
      modelRoutes: workspaceConfig.modelRoutes,
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

/** Whether a session that just ended has a turn running again, or false where no workspace is running to ask. */
function isWorkingAgain(chatId: ChatId, sessionId: StoreId.Session): boolean {
  try {
    return isWorking(chatId, sessionId);
  } catch {
    return false;
  }
}
