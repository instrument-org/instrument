import { alphabetical, parallel, unique } from "radashi";
import { z } from "zod";

import { publisher } from "../../rpc/publisher";
import { type Session } from "../../schemas/session";
import { SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { listApps } from "../apps/store";
import { getBrowserState } from "../browser-state";
import { isUntitledChatSessionTitle } from "../generate-session-title";
import { getTaskAgentStatus } from "../get-task-agent-status";
import { pathsNamedInMessage } from "../paths-named-in-message";
import { Store } from "../store";
import { taskDir } from "../task-dir-utils";
import { getTaskState, updateTaskState } from "../task-record";
import { getTaskSettings } from "../task-settings";
import { getWorkspaceActorRef } from "../workspace-actor-ref";
import { getWorkspaceConfig } from "../workspace-config";
import {
  askIn,
  latestStepIn,
  type OrchestratorActivity,
  orchestratorActivity,
} from "./activity";
import { latestSessionId } from "./latest-session";
import { excerptOf } from "./standing";
import { listTopics } from "./topics";
import { hasPendingWake } from "./wake";

/** How much of the agent's last reply a thread's row shows. */
const LATEST_MAX = 160;

/** How many threads are read at once when the list is built. */
const READ_LIMIT = 8;

export const ThreadSchema = z.object({
  /**
   * Whether the thread has been put away. The list still carries it, and
   * the window keeps it out of the inbox.
   */
  archived: z.boolean(),
  /** Whether the user starred it: a mark of the user's own, meaning whatever they mean by it. */
  starred: z.boolean(),
  /** When the root was sent, in ms. */
  createdAt: z.number(),
  /**
   * What the thread has made and used, read out of what was said in it and
   * out of the tasks filed from it. Best effort: a source that is expensive
   * to read may leave its list empty.
   */
  holds: z.object({
    /** App slugs the thread called or handed to a task. */
    apps: z.array(z.string()),
    /** Paths the replies handed over in files fences, deduped, newest last. */
    files: z.array(z.string()),
    /** Hostnames the thread opened for the user. */
    sites: z.array(z.string()),
  }),
  id: StoreId.SessionSchema,
  /**
   * The one line saying where the thread stands: the step while it works,
   * the question while it waits, the first line of the last reply otherwise.
   */
  latest: z
    .object({
      at: z.number(),
      kind: z.enum(["question", "reply", "step"]),
      text: z.string(),
    })
    .optional(),
  /** When the last reply with words finished, in ms; absent until there is one. */
  lastReplyAt: z.number().optional(),
  /** The newest message that is done, which is what marking seen records. */
  newestSettledMessageId: StoreId.MessageSchema.optional(),
  /** Replies that finished with visible words. */
  replyCount: z.number(),
  /** The message that opened the thread: the user's first with words or attachments. */
  root: SessionMessage.UserSchemaWithParts,
  /** The tasks filed from this thread that are at work right now. */
  runningTasks: z.array(
    z.object({
      id: TaskIdSchema,
      step: z.string().optional(),
      title: z.string(),
      /** What it has stopped to ask the user for; present while it is stalled on that rather than moving. */
      waiting: z.string().optional(),
    }),
  ),
  /**
   * Working while the thread's own agent is alive or a task filed from it is
   * moving; waiting while a task filed from it is stopped on an ask, or its
   * own last turn ended on one; idle otherwise.
   */
  state: z.enum(["idle", "waiting", "working"]),
  title: z.string(),
  /**
   * Whether the agent has named the thread. Until it has, `title` is the
   * ask's own first words, which a row need not repeat under the ask.
   */
  titled: z.boolean(),
  /** Topic ids, from the session record. */
  topics: z.array(z.string()),
  /** Non-user messages after the newest the user has seen; all of them when nothing is recorded. */
  unread: z.number(),
  /** When anything last happened in it, in ms. */
  updatedAt: z.number(),
});

export type Thread = z.output<typeof ThreadSchema>;

/** What every thread of a conversation is read against, loaded once per list. */
interface Shared {
  activity: OrchestratorActivity;
  /** The apps the workspace has, so a hold names only a real one. */
  knownApps: Set<string>;
  seen: Record<string, StoreId.Message>;
  taskThreads: Record<string, StoreId.Session>;
}

/**
 * Puts a thread away. The list still carries it, marked, and its stamp stays
 * where it was: putting a thread away is not something happening in it.
 */
export async function archiveThread(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<boolean> {
  return saveArchivedAt(taskId, sessionId, new Date());
}

/**
 * The conversation's threads, oldest first.
 *
 * Every top-level session of the orchestrator task is a thread once the user
 * has opened it with a message; a session with no such message (one a wake
 * made before anyone typed, say) is not one and is left out.
 */
export async function listThreads(taskId: TaskId): Promise<Thread[]> {
  const sessions = await Store.getSessions(taskId);
  if (sessions.isErr()) {
    return [];
  }
  const shared = await loadShared(taskId);
  const threads = await parallel(
    { limit: READ_LIMIT },
    alphabetical(sessions.value, (session) => session.id),
    (session) => threadFor(taskId, session, shared),
  );
  return threads.filter((thread) => thread !== undefined);
}

/** Records what the user has seen in a thread, so its count can clear. */
export async function markThreadSeen(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<void> {
  const messages = await Store.getMessagesWithParts({ sessionId, taskId });
  if (messages.isErr()) {
    return;
  }
  const newest = newestSettledIn(messages.value);
  if (!newest) {
    return;
  }
  await updateTaskState(taskDir(taskId), (state) => ({
    threadSeen: { ...state.threadSeen, [sessionId]: newest },
  }));
  // What was seen is a fact about the session as the window shows it, and the
  // live list re-reads on the session's events, so the count clears the
  // moment the thread is opened rather than the next time something is said.
  publisher.publish("session.updated", { id: taskId, sessionId });
}

/**
 * Puts a thread back among the unread: its newest finished reply counts as
 * unseen again, and only that one, since what the user asks for is the
 * thread's dot back rather than every reply it ever had. A thread with no
 * finished reply has nothing to put back.
 */
export async function markThreadUnseen(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<void> {
  const messages = await Store.getMessagesWithParts({ sessionId, taskId });
  if (messages.isErr()) {
    return;
  }
  const ordered = alphabetical(messages.value, (message) => message.id);
  const newest = ordered.findLast(countsAsUnread);
  if (!newest) {
    return;
  }
  const before = ordered
    .slice(0, ordered.indexOf(newest))
    .findLast((message) => message.role !== "session-context");
  await updateTaskState(taskDir(taskId), (state) => {
    const { [sessionId]: _seen, ...rest } = state.threadSeen ?? {};
    return {
      threadSeen: before ? { ...rest, [sessionId]: before.id } : rest,
    };
  });
  publisher.publish("session.updated", { id: taskId, sessionId });
}

/**
 * Names a thread the way the user typed it, which settles its title: the
 * app never renames a thread the user has named.
 */
export async function renameThread(
  taskId: TaskId,
  sessionId: StoreId.Session,
  title: string,
): Promise<boolean> {
  return saveMark(taskId, sessionId, (session) => ({
    ...session,
    title,
    titleSettledAt: new Date(),
  }));
}

/** Stars a thread, or takes the star off. The stamp stays where it was, as with putting a thread away. */
export async function setThreadStarred(
  taskId: TaskId,
  sessionId: StoreId.Session,
  starred: boolean,
): Promise<boolean> {
  return saveMark(taskId, sessionId, (session) => {
    const { starredAt: _was, ...rest } = session;
    return { ...rest, ...(starred ? { starredAt: new Date() } : {}) };
  });
}

/**
 * Tags a thread with topics, by id. Ids the conversation has no topic for
 * are dropped rather than written, so the record never names a topic that
 * was never made.
 */
export async function setThreadTopics(
  taskId: TaskId,
  sessionId: StoreId.Session,
  topics: string[],
): Promise<boolean> {
  const session = await Store.getSession(sessionId, taskId);
  if (session.isErr()) {
    return false;
  }
  const existing = await listTopics(taskId);
  const known = new Set(existing.map((topic) => topic.id));
  const saved = await Store.saveSession(
    {
      ...session.value,
      topics: unique(topics.filter((id) => known.has(id))),
    },
    taskId,
  );
  return saved.isOk();
}

/** Records that the app is done naming a thread, leaving any rename after it to the user. */
export async function settleThreadTitle(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<boolean> {
  return saveMark(taskId, sessionId, (session) => ({
    ...session,
    titleSettledAt: new Date(),
  }));
}

/** One thread by its session id, or none for a session that is not one. */
export async function threadById(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<Thread | undefined> {
  const session = await Store.getSession(sessionId, taskId);
  if (session.isErr() || session.value.parentId) {
    return undefined;
  }
  return threadFor(taskId, session.value, await loadShared(taskId));
}

/**
 * Whether anything of the thread's is still moving: its own agent, or a task
 * filed from it that is not stopped on an ask. A thread that is not has
 * settled, and the next move is the user's.
 */
export async function threadIsWorking(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<boolean> {
  if (threadIsAlive(taskId, sessionId)) {
    return true;
  }
  const { running } = await orchestratorActivity(taskId);
  return running.some((task) => task.thread === sessionId && !task.waiting);
}

/** Brings a thread back into the inbox. */
export async function unarchiveThread(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<boolean> {
  return saveArchivedAt(taskId, sessionId, undefined);
}

/** The app slugs a thread reached: its own calls and the grants of its tasks. */
async function appsHeld(
  messages: SessionMessage.WithParts[],
  filedTasks: TaskId[],
  known: Set<string>,
): Promise<string[]> {
  const slugs = bashCommandsIn(messages).flatMap(appSlugsIn);
  for (const filed of filedTasks) {
    const settings = await getTaskSettings(taskDir(filed));
    slugs.push(...(settings?.apps ?? []));
  }
  return unique(knownAmong(slugs, known));
}

/**
 * The app slugs a shell command calls or asks the user to connect: `app call`
 * or `app request` where a command begins, followed by a slug's own letters.
 * Anchored to the command's start and to a slug's shape so the same words
 * inside a brief's prose ("keep the app request intact.") name nothing.
 */
function appSlugsIn(command: string): string[] {
  return [
    ...command.matchAll(
      /(?:^|[\n;&|]|\$\()\s*app\s+(?:call|request)\s+([a-z0-9][a-z0-9_-]*)\b/g,
    ),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
}

/**
 * What the thread has stopped for, and when: a task filed from it that is
 * paused on an ask comes first, since that is what the user can answer, then
 * the thread's own last turn ending on one.
 */
function askOf(
  messages: SessionMessage.WithParts[],
  filed: OrchestratorActivity["running"],
): undefined | { at: number; text: string } {
  for (const task of filed) {
    if (task.waiting) {
      return { at: task.updatedAt, text: task.waiting };
    }
  }
  const text = askIn(messages);
  const last = messages.findLast((message) => message.role === "assistant");
  return text && last
    ? { at: last.metadata.createdAt.getTime(), text }
    : undefined;
}

/** The command a shell call ran, once its input has arrived whole. */
function bashCommandOf(part: SessionMessagePart.Type): string | undefined {
  if (part.type !== "tool-bash") {
    return undefined;
  }
  const input: unknown = part.input;
  return typeof input === "object" &&
    input !== null &&
    "command" in input &&
    typeof input.command === "string"
    ? input.command
    : undefined;
}

/** Every command the thread's agent ran in its shell, oldest first. */
function bashCommandsIn(messages: SessionMessage.WithParts[]): string[] {
  return messages.flatMap((message) =>
    message.role === "assistant"
      ? message.parts.flatMap((part) => {
          const command = bashCommandOf(part);
          return command === undefined ? [] : [command];
        })
      : [],
  );
}

/** A message the user could have missed: a finished reply, or anything else that is not their own. */
function countsAsUnread(message: SessionMessage.WithParts): boolean {
  return (
    message.role !== "user" &&
    message.role !== "session-context" &&
    (message.role !== "assistant" || message.metadata.finishedAt !== undefined)
  );
}

/** The paths the replies handed over, deduped, the newest mention last. */
function filesHeld(messages: SessionMessage.WithParts[]): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const path of pathsNamedInMessage(message)) {
      files.delete(path);
      files.add(path);
    }
  }
  return [...files];
}

/**
 * The first line with words, cut to what a row can show. Fenced blocks are
 * skipped whole: a reply that opens with the files it hands over is read by
 * its words, and one that is only that fence by what it wrote.
 */
function firstLine(text: string): string {
  return excerptOf(text, LATEST_MAX);
}

function hasWords(message: SessionMessage.WithParts): boolean {
  return message.parts.some(
    (part) => part.type === "text" && part.text.trim() !== "",
  );
}

/** Whether a user message opens a thread: it has words, or it brought files. */
function isRoot(
  message: SessionMessage.WithParts,
): message is SessionMessage.UserWithParts {
  if (message.role !== "user") {
    return false;
  }
  return (
    hasWords(message) ||
    message.parts.some(
      (part) =>
        part.type === "data-attachments" &&
        (part.data.files.length > 0 || (part.data.folders?.length ?? 0) > 0),
    )
  );
}

/** The slugs among `slugs` that name an app the workspace has, when it has any. */
function knownAmong(slugs: string[], known: Set<string>): string[] {
  return known.size === 0 ? slugs : slugs.filter((slug) => known.has(slug));
}

/**
 * The slugs of the apps this workspace has, for telling a real app apart from
 * a word that looked like one. Empty when the workspace has no apps folder
 * yet, in which case nothing is known and nothing is filtered.
 */
async function knownAppSlugs(): Promise<Set<string>> {
  const { apps } = await listApps(getWorkspaceConfig().appsDir);
  return new Set(apps.map((app) => app.slug));
}

function latestFor({
  ask,
  lastMessage,
  messages,
  runningStep,
  state,
}: {
  ask: undefined | { at: number; text: string };
  lastMessage: SessionMessage.WithParts | undefined;
  messages: SessionMessage.WithParts[];
  runningStep: string | undefined;
  state: Thread["state"];
}): Thread["latest"] {
  if (state === "working") {
    const step = runningStep ?? latestStepIn(messages);
    if (step && lastMessage) {
      return {
        at: lastMessage.metadata.createdAt.getTime(),
        kind: "step",
        text: step,
      };
    }
    // Working with no step to name yet, as right after a message is sent:
    // the row keeps the last thing said rather than going blank under the
    // title, which would shrink it.
  }
  if (ask) {
    return { at: ask.at, kind: "question", text: ask.text };
  }
  // The last reply with words in it, since a turn can end on a tool call
  // with nothing said, and the row wants the last thing the agent told them.
  const spoken = messages.findLast(
    (message) => message.role === "assistant" && hasWords(message),
  );
  if (spoken?.role !== "assistant") {
    return undefined;
  }
  return {
    at: (spoken.metadata.finishedAt ?? spoken.metadata.createdAt).getTime(),
    kind: "reply",
    text: firstLine(textOf(spoken)),
  };
}

async function loadShared(taskId: TaskId): Promise<Shared> {
  const state = await getTaskState(taskDir(taskId));
  return {
    activity: await orchestratorActivity(taskId),
    knownApps: await knownAppSlugs(),
    seen: state.threadSeen ?? {},
    taskThreads: state.taskThreads ?? {},
  };
}

/**
 * The newest message that is done: the user's own, or a reply that has
 * finished. A reply still being written is not seen by being on screen when
 * it starts, and marking it so would leave the thread silent about what it
 * went on to say after the user left.
 */
function newestSettledIn(
  messages: SessionMessage.WithParts[],
): StoreId.Message | undefined {
  const settled = messages.filter(
    (message) =>
      message.role === "user" ||
      (message.role === "assistant" &&
        message.metadata.finishedAt !== undefined),
  );
  return alphabetical(settled, (message) => message.id).at(-1)?.id;
}

/** The hostnames a shell command opens for the user with `open <url>`. */
function openedHostsIn(command: string): string[] {
  const hosts: string[] = [];
  for (const match of command.matchAll(
    /(?:^|[\n;&|])\s*open\s+['"]?(https?:\/\/[^\s'"]+)/g,
  )) {
    try {
      hosts.push(new URL(match[1] ?? "").hostname);
    } catch {
      // Not an address the shell would have opened either.
    }
  }
  return hosts.filter((host) => host !== "");
}

/**
 * Writes when the thread was put away, or takes it off the record. Saving
 * the session announces the change, which is what makes the live list
 * re-read.
 */
async function saveArchivedAt(
  taskId: TaskId,
  sessionId: StoreId.Session,
  archivedAt: Date | undefined,
): Promise<boolean> {
  return saveMark(taskId, sessionId, (session) => {
    const { archivedAt: _was, ...rest } = session;
    return { ...rest, ...(archivedAt ? { archivedAt } : {}) };
  });
}

/** Writes a mark of the user's onto the session record, announcing the change so the live list re-reads. */
async function saveMark(
  taskId: TaskId,
  sessionId: StoreId.Session,
  mark: (session: Session.Type) => Session.Type,
): Promise<boolean> {
  const session = await Store.getSession(sessionId, taskId);
  if (session.isErr()) {
    return false;
  }
  const saved = await Store.saveSession(mark(session.value), taskId);
  return saved.isOk();
}

/**
 * The hostnames the thread's work touched: what its agent opened for the user
 * with `open <url>`, then every host the browsers of the tasks it filed have
 * been on, each task's newest last. A task's hosts come from its browser
 * state, one small read per task, rather than from its transcript.
 */
async function sitesHeld(
  messages: SessionMessage.WithParts[],
  filedTasks: TaskId[],
): Promise<string[]> {
  const hosts = bashCommandsIn(messages).flatMap(openedHostsIn);
  for (const filed of filedTasks) {
    const sessionId = await latestSessionId(filed);
    if (sessionId.isErr() || !sessionId.value) {
      continue;
    }
    const browser = await getBrowserState(filed, sessionId.value);
    if (browser.isOk()) {
      hosts.push(...(browser.value?.visitedHosts ?? []));
    }
  }
  return unique(hosts);
}

function textOf(message: SessionMessage.WithParts): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

async function threadFor(
  taskId: TaskId,
  session: Session.Type,
  shared: Shared,
): Promise<Thread | undefined> {
  const read = await Store.getMessagesWithParts({
    sessionId: session.id,
    taskId,
  });
  if (read.isErr()) {
    return undefined;
  }
  const messages = alphabetical(read.value, (message) => message.id);
  const root = messages.find(isRoot);
  if (!root) {
    return undefined;
  }

  const filedTasks = Object.entries(shared.taskThreads).flatMap(
    ([filed, sessionId]) =>
      sessionId === session.id ? [TaskIdSchema.parse(filed)] : [],
  );
  const filed = shared.activity.running.filter(
    (task) => task.thread === session.id,
  );
  const runningTasks = filed.map((task) => ({
    id: task.taskId,
    ...(task.step ? { step: task.step } : {}),
    title: task.title,
    ...(task.waiting ? { waiting: task.waiting } : {}),
  }));

  // A task stopped on an ask is running to the machine and stalled to the
  // user, so it does not make the thread work; it makes it wait, unless
  // something else in the thread is moving. The thread's own agent stopped
  // on an ask of its own is the same: alive to the machine, waiting to the
  // user.
  const ownAsk = askIn(messages);
  const working =
    (threadIsAlive(taskId, session.id) && ownAsk === undefined) ||
    turnIsStarting(messages) ||
    filed.some((task) => !task.waiting) ||
    filedTasks.some((filedTask) => hasPendingWake(taskId, filedTask));
  const ask = working ? undefined : askOf(messages, filed);
  const state = working ? "working" : ask ? "waiting" : "idle";

  const seen = shared.seen[session.id];
  // A reply still being written is not news yet: it counts once it has
  // finished, which is also when marking the thread seen would record it.
  const unread = messages.filter(
    (message) =>
      countsAsUnread(message) && (seen === undefined || message.id > seen),
  ).length;

  const lastMessage = messages.at(-1);
  const latest = latestFor({
    ask,
    lastMessage,
    messages,
    runningStep: runningTasks.find((task) => task.step && !task.waiting)?.step,
    state,
  });

  const newestSettledMessageId = newestSettledIn(messages);
  const replies = messages.filter(
    (message): message is SessionMessage.AssistantWithParts =>
      message.role === "assistant" &&
      message.metadata.finishedAt !== undefined &&
      hasWords(message),
  );
  const lastReply = replies.at(-1)?.metadata.finishedAt;
  return {
    archived: session.archivedAt !== undefined,
    createdAt: root.metadata.createdAt.getTime(),
    holds: {
      apps: await appsHeld(messages, filedTasks, shared.knownApps),
      files: filesHeld(messages),
      sites: await sitesHeld(messages, filedTasks),
    },
    id: session.id,
    starred: session.starredAt !== undefined,
    ...(latest ? { latest } : {}),
    ...(lastReply ? { lastReplyAt: lastReply.getTime() } : {}),
    ...(newestSettledMessageId ? { newestSettledMessageId } : {}),
    replyCount: replies.length,
    root,
    runningTasks,
    state,
    // Until the agent names the thread, the ask's own first words stand for it
    // rather than the placeholder a session is born with.
    title: isUntitledChatSessionTitle(session.title)
      ? firstLine(textOf(root)) || session.title
      : session.title,
    titled: !isUntitledChatSessionTitle(session.title),
    topics: session.topics ?? [],
    unread,
    // When anything last happened: the session's own stamp moves when a turn
    // starts, so a reply landing later and the line it is peeked by count too.
    updatedAt: Math.max(
      (session.updatedAt ?? session.createdAt).getTime(),
      lastReply?.getTime() ?? 0,
      latest?.at ?? 0,
    ),
  };
}

/** Whether the thread's own agent is at work this moment. */
/**
 * How long a message with no reply yet counts as its turn starting. A message
 * is written before the agent it starts is running, so a list read between the
 * two would otherwise call the thread idle and show its last reply for a
 * moment; one that never starts an agent stops counting after this.
 */
const TURN_START_GRACE_MS = 30_000;

function threadIsAlive(taskId: TaskId, sessionId: StoreId.Session): boolean {
  const status = getTaskAgentStatus({
    id: taskId,
    workspaceRef: getWorkspaceActorRef(),
  });
  return (
    status.isOk() &&
    status.value.sessionActors.some(
      (actor) =>
        actor.sessionId === sessionId && actor.tags.includes("agent.alive"),
    )
  );
}

/** The newest message is the user's or a wake's, recent, and not yet answered. */
function turnIsStarting(messages: SessionMessage.WithParts[]): boolean {
  const newest = messages.findLast(
    (message) => message.role === "user" || message.role === "assistant",
  );
  return (
    newest?.role === "user" &&
    Date.now() - newest.metadata.createdAt.getTime() < TURN_START_GRACE_MS
  );
}
