import { APP_NAME_SLUG, TASK_SETTINGS_FILE_NAME } from "@instrument-org/shared";
import { alphabetical, parallel, unique } from "radashi";
import { z } from "zod";

import { publisher } from "../../rpc/publisher";
import { type Session } from "../../schemas/session";
import { SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../../schemas/task-id";
import { absolutePathJoin } from "../absolute-path-join";
import { listApps } from "../apps/store";
import { getBrowserState } from "../browser-state";
import { isUntitledChatSessionTitle } from "../generate-session-title";
import { getTaskAgentStatus } from "../get-task-agent-status";
import { pathsNamedInMessage } from "../paths-named-in-message";
import { chatOfSession, chatTaskIds, sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { getTaskPrivateDir, taskDir } from "../task-dir-utils";
import { getTaskState, updateTaskState } from "../task-record";
import { getTaskSettings } from "../task-settings";
import { getWorkspaceActorRef } from "../workspace-actor-ref";
import { getWorkspaceConfig } from "../workspace-config";
import { indexedByStore, kept, unkept } from "../workspace-index";
import {
  askIn,
  latestStepIn,
  type OrchestratorActivity,
  orchestratorActivity,
} from "./activity";
import { listChatIds } from "./chat-records";
import { windowTaskId } from "./ensure";
import { latestSessionId } from "./latest-session";
import { excerptOf } from "./standing";
import { listTopics } from "./topics";
import { hasPendingWake } from "./wake";

/** How much of the agent's last reply a chat's row shows. */
const LATEST_MAX = 160;

/** How many chats are read at once when the list is built. */
const READ_LIMIT = 8;

export const ChatSchema = z.object({
  /**
   * Whether the chat has been put away. The list still carries it, and
   * the window keeps it out of the inbox.
   */
  archived: z.boolean(),
  /** Whether the user starred it: a mark of the user's own, meaning whatever they mean by it. */
  starred: z.boolean(),
  /** The chat's own record, which its transcript and its tasks are under. */
  taskId: TaskIdSchema,
  /** When the chat began: its first message, or the session itself before one. */
  createdAt: z.number(),
  /**
   * What the chat has made and used, read out of what was said in it and
   * out of the tasks filed from it. Best effort: a source that is expensive
   * to read may leave its list empty.
   */
  holds: z.object({
    /** App slugs the chat called or handed to a task, then those the user sent from. */
    apps: z.array(z.string()),
    /**
     * Paths the user sent (a folder's with a trailing slash), then those the
     * replies handed over in files fences, each once, newest last: what the
     * chat made outranks what it was given, so it is what a row shows first.
     */
    files: z.array(z.string()),
    /** Hostnames of pages the user sent, then those the chat and its tasks opened, each once, newest last. */
    sites: z.array(z.string()),
  }),
  id: StoreId.SessionSchema,
  /**
   * The one line saying where the chat stands: the step while it works,
   * the question while it waits, the first line of the last reply otherwise.
   */
  latest: z
    .object({
      at: z.number(),
      kind: z.enum(["question", "reply", "step"]),
      text: z.string(),
    })
    .optional(),
  /** The first line of the user's newest message: what a working chat is answering. Absent when that message has no words. */
  lastAsk: z.string().optional(),
  /** When the last reply with words finished, in ms; absent until there is one. */
  lastReplyAt: z.number().optional(),
  /** The newest message that is done, which is what marking seen records. */
  newestSettledMessageId: StoreId.MessageSchema.optional(),
  /** Replies that finished with visible words. */
  replyCount: z.number(),
  /** The user's first message, whatever it carried; absent only before one is saved. */
  root: SessionMessage.UserSchemaWithParts.optional(),
  /** The tasks filed from this chat that are at work right now. */
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
   * Working while the chat's own agent is alive or a task filed from it is
   * moving; waiting while a task filed from it is stopped on an ask, or its
   * own last turn ended on one; idle otherwise.
   */
  state: z.enum(["idle", "waiting", "working"]),
  title: z.string(),
  /**
   * Whether the agent has named the chat. Until it has, `title` is the
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

export type Chat = z.output<typeof ChatSchema>;

/**
 * Each chat's messages as last read, oldest first, by task and session.
 * Reading every part of every chat is most of what building the list
 * costs, and most rebuilds follow a change in one chat (a reply streaming)
 * or in none (an archive, a star, a chat marked seen). An entry goes as
 * soon as the store announces a change to its session, so the read after a
 * write is always a fresh one; a read already on its way when the change
 * lands is dropped with it rather than kept.
 */
const messagesBySession = new Map<
  string,
  Promise<SessionMessage.WithParts[] | undefined>
>();

/**
 * The apps a filed task was given, as last read from its settings. Every
 * write to them announces `task.updated`, which drops the entry.
 */
const filedAppsByTask = new Map<TaskId, Promise<string[]>>();
publisher.subscribe("task.updated", ({ id }) => {
  filedAppsByTask.delete(id);
});

function forgetSession({
  id,
  sessionId,
}: {
  id: TaskId;
  sessionId: StoreId.Session;
}) {
  messagesBySession.delete(sessionKey(id, sessionId));
}

function sessionKey(taskId: TaskId, sessionId: StoreId.Session): string {
  return `${taskId}\n${sessionId}`;
}
publisher.subscribe("message.updated", forgetSession);
publisher.subscribe("message.removed", forgetSession);
publisher.subscribe("session.removed", forgetSession);
publisher.subscribe("part.updated", ({ id, part }) => {
  forgetSession({ id, sessionId: part.metadata.sessionId });
});
publisher.subscribe("task.removed", ({ id }) => {
  filedAppsByTask.delete(id);
  for (const key of messagesBySession.keys()) {
    if (key.startsWith(`${id}\n`)) {
      messagesBySession.delete(key);
    }
  }
});

/** What every chat of a conversation is read against, loaded once per list. */
interface Shared {
  activity: OrchestratorActivity;
  /** The apps the workspace has, so a hold names only a real one. */
  knownApps: Set<string>;
  seen: Record<string, StoreId.Message>;
}

/**
 * Puts a chat away. The list still carries it, marked, and its stamp stays
 * where it was: putting a chat away is not something happening in it.
 */
export async function archiveChat(
  sessionId: StoreId.Session,
): Promise<boolean> {
  return saveArchivedAt(sessionId, new Date());
}

/** One chat by its session id, or none for a session that is not one. */
export async function chatById(
  sessionId: StoreId.Session,
): Promise<Chat | undefined> {
  const taskId = chatOfSession(sessionId);
  if (!taskId) {
    return undefined;
  }
  const digest = await chatDigest(taskId, sessionId);
  if (!digest || digest.session.parentId) {
    return undefined;
  }
  return chatFor(digest, taskId, await loadShared());
}

/**
 * Whether anything of the chat's is still moving: its own agent, or a task
 * filed from it that is not stopped on an ask. A chat that is not has
 * settled, and the next move is the user's.
 */
export async function chatIsWorking(
  sessionId: StoreId.Session,
): Promise<boolean> {
  if (chatIsAlive(sessionId)) {
    return true;
  }
  const taskId = chatOfSession(sessionId);
  if (!taskId) {
    return false;
  }
  const { running } = await orchestratorActivity(taskId);
  return running.some((task) => !task.waiting);
}

/**
 * A chat's title as its record holds it, read from its digest so a chat
 * whose store has not changed is not opened to answer.
 */
export async function chatRecordTitle(
  sessionId: StoreId.Session,
): Promise<string | undefined> {
  const taskId = chatOfSession(sessionId);
  if (!taskId) {
    return undefined;
  }
  const digest = await chatDigest(taskId, sessionId);
  return digest?.session.title;
}

/**
 * Every chat, oldest first.
 *
 * Each chat is a record of its own holding one session, and it is a chat
 * once the user has opened it with a message; one with no such message (made
 * by a send that failed partway, say) is left out.
 */
export async function listChats(): Promise<Chat[]> {
  const shared = await loadShared();
  const chats = await parallel(
    { limit: READ_LIMIT },
    listChatIds(),
    async (chatId) => {
      const sessionId = sessionOfChat(chatId);
      if (!sessionId) {
        return;
      }
      const digest = await chatDigest(chatId, sessionId);
      return digest ? chatFor(digest, chatId, shared) : undefined;
    },
  );
  return chats.filter((chat) => chat !== undefined);
}

/**
 * Why `listChats` leaves a chat with a session out, or none when it lists it.
 * A chat whose digest is kept answers from it without opening its store.
 */
export async function chatReadProblem(
  chatId: TaskId,
  sessionId: StoreId.Session,
): Promise<"unreadable-messages" | "unreadable-session" | undefined> {
  if (await chatDigest(chatId, sessionId)) {
    return undefined;
  }
  const session = await Store.getSession(sessionId, chatId);
  return session.isErr() ? "unreadable-session" : "unreadable-messages";
}

/** Records what the user has seen in a chat, so its count can clear. */
export async function markChatSeen(sessionId: StoreId.Session): Promise<void> {
  const messages = await chatMessages(sessionId);
  if (!messages) {
    return;
  }
  const newest = newestSettledIn(messages);
  if (!newest) {
    return;
  }
  await updateTaskState(taskDir(await windowTaskId()), (state) => ({
    chatSeen: { ...state.chatSeen, [sessionId]: newest },
  }));
  // What was seen is a fact about the session as the window shows it, and the
  // live list re-reads on the session's events, so the count clears the
  // moment the chat is opened rather than the next time something is said.
  const chatId = chatOfSession(sessionId);
  if (chatId) {
    publisher.publish("session.updated", { id: chatId, sessionId });
  }
}

/**
 * Puts a chat back among the unread: its newest finished reply counts as
 * unseen again, and only that one, since what the user asks for is the
 * chat's dot back rather than every reply it ever had. A chat with no
 * finished reply has nothing to put back.
 */
export async function markChatUnseen(
  sessionId: StoreId.Session,
): Promise<void> {
  const ordered = await chatMessages(sessionId);
  if (!ordered) {
    return;
  }
  const newest = ordered.findLast(countsAsUnread);
  if (!newest) {
    return;
  }
  const before = ordered
    .slice(0, ordered.indexOf(newest))
    .findLast((message) => message.role !== "session-context");
  await updateTaskState(taskDir(await windowTaskId()), (state) => {
    const { [sessionId]: _seen, ...rest } = state.chatSeen ?? {};
    return {
      chatSeen: before ? { ...rest, [sessionId]: before.id } : rest,
    };
  });
  const chatId = chatOfSession(sessionId);
  if (chatId) {
    publisher.publish("session.updated", { id: chatId, sessionId });
  }
}

/**
 * Names a chat the way the user typed it, which settles its title: the
 * app never renames a chat the user has named.
 */
export async function renameChat(
  sessionId: StoreId.Session,
  title: string,
): Promise<boolean> {
  return saveMark(sessionId, (session) => ({
    ...session,
    title,
    titleSettledAt: new Date(),
  }));
}

/** Stars a chat, or takes the star off. The stamp stays where it was, as with putting a chat away. */
export async function setChatStarred(
  sessionId: StoreId.Session,
  starred: boolean,
): Promise<boolean> {
  return saveMark(sessionId, (session) => {
    const { starredAt: _was, ...rest } = session;
    return { ...rest, ...(starred ? { starredAt: new Date() } : {}) };
  });
}

/**
 * Tags a chat with topics, by id. Ids the conversation has no topic for
 * are dropped rather than written, so the record never names a topic that
 * was never made.
 */
export async function setChatTopics(
  sessionId: StoreId.Session,
  topics: string[],
): Promise<boolean> {
  const taskId = chatOfSession(sessionId);
  if (!taskId) {
    return false;
  }
  const session = await Store.getSession(sessionId, taskId);
  if (session.isErr()) {
    return false;
  }
  const existing = await listTopics();
  const known = new Set(existing.map((topic) => topic.id));
  const saved = await Store.saveSession(
    {
      ...session.value,
      topics: unique(topics.filter((id) => known.has(id))),
    },
    taskId,
  );
  // The chat reaches its topics' folders (folder-reach.ts), so its state's
  // readers hear of a change of topic.
  publisher.publish("task.updated", { id: taskId });
  return saved.isOk();
}

/** Records that the app is done naming a chat, leaving any rename after it to the user. */
export async function settleChatTitle(
  sessionId: StoreId.Session,
): Promise<boolean> {
  return saveMark(sessionId, (session) => ({
    ...session,
    titleSettledAt: new Date(),
  }));
}

/** Brings a chat back into the inbox. */
export async function unarchiveChat(
  sessionId: StoreId.Session,
): Promise<boolean> {
  return saveArchivedAt(sessionId, undefined);
}

/** The app slugs a chat reached: its own calls and the grants of its tasks. */
async function appsHeld(
  calledApps: string[],
  filedTasks: TaskId[],
  known: Set<string>,
): Promise<string[]> {
  const slugs = [...calledApps];
  for (const filed of filedTasks) {
    slugs.push(...(await filedApps(filed)));
  }
  return unique(knownAmong(slugs, known));
}

/**
 * The same apps across launches, kept in the index against the task's
 * settings as well as its store, since the settings are where they are
 * written. Held in memory by `filedAppsByTask`, which hears every write.
 */
const appsIndex = indexedByStore<string[]>("task_apps", {
  files: (taskId) => [
    absolutePathJoin(
      getTaskPrivateDir(taskDir(taskId)),
      TASK_SETTINGS_FILE_NAME,
    ),
  ],
  inMemory: false,
});

function filedApps(taskId: TaskId): Promise<string[]> {
  const known = filedAppsByTask.get(taskId);
  if (known) {
    return known;
  }
  const read = appsIndex(taskId, () =>
    getTaskSettings(taskDir(taskId)).then((settings) =>
      kept(settings?.apps ?? []),
    ),
  );
  filedAppsByTask.set(taskId, read);
  read.catch(() => {
    filedAppsByTask.delete(taskId);
  });
  return read;
}

/**
 * The hosts a filed task's newest session has visited, held until its store
 * is written: the browser records a visit there and announces nothing.
 */
const filedHosts = indexedByStore<string[]>("task_hosts");

/**
 * What a chat's row is made from that its own store holds: its session
 * record and what its messages say, boiled down to what the row reads. Kept
 * in the workspace index, so a chat whose store has not changed since the
 * last launch draws its row without its transcript being read.
 */
interface ChatDigest {
  /** Commands' `app call` and `app request` slugs. */
  calledApps: string[];
  lastAsk: string;
  /** When the last assistant message started, which an ask of its own is dated by. */
  lastAssistantAt?: number;
  lastMessageAt?: number;
  lastReplyAt?: number;
  madeFiles: string[];
  newestSettledMessageId?: StoreId.Message;
  /** The newest user or assistant message's role and time, which says whether a turn is starting. */
  newestTurn?: { at: number; role: "assistant" | "user" };
  openedHosts: string[];
  /** What the chat's own last turn asked the user, if it ended on an ask. */
  ownAsk?: string;
  replyCount: number;
  root?: SessionMessage.UserWithParts;
  sent: ReturnType<typeof sentHeld>;
  session: Session.Type;
  /** The last reply with words: when it finished and its first line. */
  spoken?: { at: number; text: string };
  stepInMessages?: string;
  /** Messages that count once seen, by id, against the newest the user saw. */
  unreadCandidates: StoreId.Message[];
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
 * The app slugs a message's words name: the composer writes an app picked
 * from its menu as a link into the app, `[Notion](instrument://app/notion)`.
 */
function appsMentionedIn(text: string): string[] {
  return [
    ...text.matchAll(
      new RegExp(`\\]\\(${APP_NAME_SLUG}://app/([\\w.:-]+)\\)`, "g"),
    ),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
}

/** A folder's path the way a hold names one, with a trailing slash. */
function asFolder(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

/**
 * What the chat has stopped for, and when: a task filed from it that is
 * paused on an ask comes first, since that is what the user can answer, then
 * the chat's own last turn ending on one.
 */
function askOf(
  digest: ChatDigest,
  filed: OrchestratorActivity["running"],
): undefined | { at: number; text: string } {
  for (const task of filed) {
    if (task.waiting) {
      return { at: task.updatedAt, text: task.waiting };
    }
  }
  return digest.ownAsk && digest.lastAssistantAt !== undefined
    ? { at: digest.lastAssistantAt, text: digest.ownAsk }
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

/** Every command the chat's agent ran in its shell, oldest first. */
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

/**
 * `given` with what is also in `made` taken out, ahead of `made`: in a list
 * read newest last, what the chat was given sits behind what it made.
 */
function behind(given: string[], made: string[]): string[] {
  return [...given.filter((item) => !made.includes(item)), ...made];
}

async function chatFor(
  digest: ChatDigest,
  taskId: TaskId,
  shared: Shared,
): Promise<Chat> {
  const { root, session } = digest;
  const filedTasks = chatTaskIds(taskId);
  const filed = shared.activity.running.filter(
    (task) => task.chat === session.id,
  );
  const runningTasks = filed.map((task) => ({
    id: task.taskId,
    ...(task.step ? { step: task.step } : {}),
    title: task.title,
    ...(task.waiting ? { waiting: task.waiting } : {}),
  }));

  // A task stopped on an ask is running to the machine and stalled to the
  // user, so it does not make the chat work; it makes it wait, unless
  // something else in the chat is moving. The chat's own agent stopped
  // on an ask of its own is the same: alive to the machine, waiting to the
  // user.
  const working =
    (chatIsAlive(session.id) && digest.ownAsk === undefined) ||
    turnIsStarting(digest) ||
    filed.some((task) => !task.waiting) ||
    filedTasks.some((filedTask) => hasPendingWake(taskId, filedTask));
  const ask = working ? undefined : askOf(digest, filed);
  const state = working ? "working" : ask ? "waiting" : "idle";

  const seen = shared.seen[session.id];
  // A reply still being written is not news yet: it counts once it has
  // finished, which is also when marking the chat seen would record it.
  const unread = digest.unreadCandidates.filter(
    (id) => seen === undefined || id > seen,
  ).length;

  const latest = latestFor({
    ask,
    digest,
    runningStep: runningTasks.find((task) => task.step && !task.waiting)?.step,
    state,
  });

  const { sent } = digest;
  const made = {
    apps: await appsHeld(digest.calledApps, filedTasks, shared.knownApps),
    files: digest.madeFiles,
    sites: await sitesHeld(digest.openedHosts, filedTasks),
  };

  return {
    archived: session.archivedAt !== undefined,
    createdAt: (root?.metadata.createdAt ?? session.createdAt).getTime(),
    holds: {
      apps: [
        ...made.apps,
        ...knownAmong(sent.apps, shared.knownApps).filter(
          (slug) => !made.apps.includes(slug),
        ),
      ],
      files: behind(sent.files, made.files),
      sites: behind(sent.sites, made.sites),
    },
    id: session.id,
    starred: session.starredAt !== undefined,
    taskId,
    ...(digest.lastAsk ? { lastAsk: digest.lastAsk } : {}),
    ...(latest ? { latest } : {}),
    ...(digest.lastReplyAt === undefined
      ? {}
      : { lastReplyAt: digest.lastReplyAt }),
    ...(digest.newestSettledMessageId
      ? { newestSettledMessageId: digest.newestSettledMessageId }
      : {}),
    replyCount: digest.replyCount,
    ...(root ? { root } : {}),
    runningTasks,
    state,
    // Until the agent names the chat, the ask's own first words stand for it
    // rather than the placeholder a session is born with.
    title: isUntitledChatSessionTitle(session.title)
      ? firstLine(root ? textOf(root) : "") || session.title
      : session.title,
    titled: !isUntitledChatSessionTitle(session.title),
    topics: session.topics ?? [],
    unread,
    // When anything last happened: the session's own stamp moves when a turn
    // starts, so a reply landing later and the line it is peeked by count too.
    updatedAt: Math.max(
      (session.updatedAt ?? session.createdAt).getTime(),
      digest.lastReplyAt ?? 0,
      latest?.at ?? 0,
    ),
  };
}

/** Each chat's digest, kept until its store changes. */
const chatDigests = indexedByStore<ChatDigest | undefined>("chat_digests");

/** A chat's digest, or none when its record or its messages cannot be read. */
function chatDigest(
  taskId: TaskId,
  sessionId: StoreId.Session,
): Promise<ChatDigest | undefined> {
  return chatDigests(taskId, async () => {
    const session = await Store.getSession(sessionId, taskId);
    if (session.isErr()) {
      return unkept(undefined);
    }
    const messages = await Store.getMessagesWithParts({ sessionId, taskId });
    return messages.isOk()
      ? kept(digestOf(session.value, messages.value))
      : unkept(undefined);
  });
}

/** A chat's messages, oldest first, or nothing when they cannot be read. */
function chatMessages(
  sessionId: StoreId.Session,
): Promise<SessionMessage.WithParts[] | undefined> {
  const taskId = chatOfSession(sessionId);
  if (!taskId) {
    return Promise.resolve(undefined);
  }
  const key = sessionKey(taskId, sessionId);
  const cached = messagesBySession.get(key);
  if (cached) {
    return cached;
  }
  const read = Promise.resolve(
    Store.getMessagesWithParts({ sessionId, taskId }),
  ).then((result) => {
    if (result.isErr()) {
      // A failed read is not remembered: the next list tries again.
      if (messagesBySession.get(key) === read) {
        messagesBySession.delete(key);
      }
      return;
    }
    return alphabetical(result.value, (message) => message.id);
  });
  messagesBySession.set(key, read);
  return read;
}

/** A message the user could have missed: a finished reply, or anything else that is not their own. */
function countsAsUnread(message: SessionMessage.WithParts): boolean {
  return (
    message.role !== "user" &&
    message.role !== "session-context" &&
    (message.role !== "assistant" || message.metadata.finishedAt !== undefined)
  );
}

function digestOf(
  session: Session.Type,
  messages: SessionMessage.WithParts[],
): ChatDigest {
  // Every chat is listed: the first thing the user sent opens it, whether
  // words, files, or an ask marked on a file.
  const root = messages.find(
    (message): message is SessionMessage.UserWithParts =>
      message.role === "user",
  );
  const lastAssistant = messages.findLast(
    (message) => message.role === "assistant",
  );
  const newestTurn = messages.findLast(
    (
      message,
    ): message is
      | SessionMessage.AssistantWithParts
      | SessionMessage.UserWithParts =>
      message.role === "user" || message.role === "assistant",
  );
  const lastUser = messages.findLast((message) => message.role === "user");
  const spoken = messages.findLast(
    (message) => message.role === "assistant" && hasWords(message),
  );
  const replies = messages.filter(
    (message): message is SessionMessage.AssistantWithParts =>
      message.role === "assistant" &&
      message.metadata.finishedAt !== undefined &&
      hasWords(message),
  );
  const commands = bashCommandsIn(messages);
  const ownAsk = askIn(messages);
  const stepInMessages = latestStepIn(messages);
  const lastMessageAt = messages.at(-1)?.metadata.createdAt.getTime();
  const lastReplyAt = replies.at(-1)?.metadata.finishedAt?.getTime();
  const newestSettledMessageId = newestSettledIn(messages);
  return {
    calledApps: commands.flatMap(appSlugsIn),
    ...(lastAssistant && {
      lastAssistantAt: lastAssistant.metadata.createdAt.getTime(),
    }),
    lastAsk: lastUser ? firstLine(textOf(lastUser)) : "",
    ...(lastMessageAt !== undefined && { lastMessageAt }),
    ...(lastReplyAt !== undefined && { lastReplyAt }),
    madeFiles: filesHeld(messages),
    ...(newestSettledMessageId && { newestSettledMessageId }),
    ...(newestTurn && {
      newestTurn: {
        at: newestTurn.metadata.createdAt.getTime(),
        role: newestTurn.role,
      },
    }),
    openedHosts: commands.flatMap(openedHostsIn),
    ...(ownAsk !== undefined && { ownAsk }),
    replyCount: replies.length,
    ...(root && { root }),
    sent: sentHeld(messages),
    session,
    ...(spoken?.role === "assistant" && {
      spoken: {
        at: (spoken.metadata.finishedAt ?? spoken.metadata.createdAt).getTime(),
        text: firstLine(textOf(spoken)),
      },
    }),
    ...(stepInMessages !== undefined && { stepInMessages }),
    unreadCandidates: messages.filter(countsAsUnread).map(({ id }) => id),
  };
}

function filedHostsOf(taskId: TaskId): Promise<string[]> {
  return filedHosts(taskId, async () => {
    const sessionId = await latestSessionId(taskId);
    if (sessionId.isErr()) {
      return unkept([]);
    }
    if (!sessionId.value) {
      return kept([]);
    }
    const browser = await getBrowserState(taskId, sessionId.value);
    return browser.isOk()
      ? kept(browser.value?.visitedHosts ?? [])
      : unkept([]);
  });
}

/**
 * The paths the replies handed over, deduped, the newest mention last. A chat
 * made from an earlier version's task holds that task's files first.
 */
function filesHeld(messages: SessionMessage.WithParts[]): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-adoptedTask") {
        for (const path of part.data.files) {
          files.add(path);
        }
      }
    }
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
  digest,
  runningStep,
  state,
}: {
  ask: undefined | { at: number; text: string };
  digest: ChatDigest;
  runningStep: string | undefined;
  state: Chat["state"];
}): Chat["latest"] {
  if (state === "working") {
    const step = runningStep ?? digest.stepInMessages;
    if (step && digest.lastMessageAt !== undefined) {
      return { at: digest.lastMessageAt, kind: "step", text: step };
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
  return digest.spoken && { ...digest.spoken, kind: "reply" };
}

async function loadShared(): Promise<Shared> {
  const windowId = await windowTaskId();
  const state = await getTaskState(taskDir(windowId));
  return {
    activity: await orchestratorActivity(windowId),
    knownApps: await knownAppSlugs(),
    seen: state.chatSeen ?? {},
  };
}

/** Each item once, where it last appeared. */
function newestLast(items: string[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    seen.delete(item);
    seen.add(item);
  }
  return [...seen];
}

/**
 * The newest message that is done: the user's own, or a reply that has
 * finished. A reply still being written is not seen by being on screen when
 * it starts, and marking it so would leave the chat silent about what it
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

/** The hostnames a shell command opens for the user with `tab open <url>`. */
function openedHostsIn(command: string): string[] {
  const hosts: string[] = [];
  for (const match of command.matchAll(
    /(?:^|[\n;&|])\s*tab\s+(?:open|replace\s+\S+)\s+['"]?(https?:\/\/[^\s'"]+)/g,
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
 * Writes when the chat was put away, or takes it off the record. Saving
 * the session announces the change, which is what makes the live list
 * re-read.
 */
async function saveArchivedAt(
  sessionId: StoreId.Session,
  archivedAt: Date | undefined,
): Promise<boolean> {
  return saveMark(sessionId, (session) => {
    const { archivedAt: _was, ...rest } = session;
    return { ...rest, ...(archivedAt ? { archivedAt } : {}) };
  });
}

/** Writes a mark of the user's onto the session record, announcing the change so the live list re-reads. */
async function saveMark(
  sessionId: StoreId.Session,
  mark: (session: Session.Type) => Session.Type,
): Promise<boolean> {
  const taskId = chatOfSession(sessionId);
  if (!taskId) {
    return false;
  }
  const session = await Store.getSession(sessionId, taskId);
  if (session.isErr()) {
    return false;
  }
  const saved = await Store.saveSession(mark(session.value), taskId);
  return saved.isOk();
}

/**
 * What the user sent with their messages: the page, file, folder, or app
 * that went with each as the thing in view, what they picked by name, what
 * they dropped in, and the apps they named in their words. The rest of the window's tabs go with a message too,
 * for the agent to name, but only as a list, and a tab someone opened and
 * left is nothing they sent. Files and folders are by the path the chat
 * reaches them through, so one outside its folders is left out.
 */
function sentHeld(messages: SessionMessage.WithParts[]) {
  const apps: string[] = [];
  const files: string[] = [];
  const sites: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    for (const part of message.parts) {
      if (part.type === "text") {
        apps.push(...appsMentionedIn(part.text));
      }
      if (part.type === "data-attachments") {
        files.push(...part.data.files.map((file) => file.filePath));
      }
      if (part.type !== "data-viewContext") {
        continue;
      }
      const viewed = part.data;
      if (viewed.app) {
        apps.push(viewed.app.slug);
      }
      if (viewed.file?.mount) {
        files.push(viewed.file.mount);
      }
      // What is selected in a folder stands for it, the way the draft's
      // chip names the selection rather than the folder.
      if (viewed.folder?.mount) {
        const { mount, selected } = viewed.folder;
        files.push(
          ...(selected.length > 0
            ? selected.map((name) => `${asFolder(mount)}${name}`)
            : [asFolder(mount)]),
        );
      }
      for (const chosen of viewed.chosen ?? []) {
        if (chosen.mount) {
          files.push(
            chosen.kind === "folder" ? asFolder(chosen.mount) : chosen.mount,
          );
        }
      }
      const page =
        viewed.page?.url ??
        (viewed.screen === "browser" ? viewed.url : undefined);
      const host = page === undefined ? "" : webHostOf(page);
      if (host !== "") {
        sites.push(host);
      }
    }
  }
  return {
    apps: unique(apps),
    files: newestLast(files),
    sites: newestLast(sites),
  };
}

/**
 * The hostnames the chat's work touched: what its agent opened for the user
 * with `tab open <url>`, then every host the browsers of the tasks it filed have
 * been on, each task's newest last. A task's hosts come from its browser
 * state, one small read per task, rather than from its transcript.
 */
async function sitesHeld(
  openedHosts: string[],
  filedTasks: TaskId[],
): Promise<string[]> {
  const hosts = [...openedHosts];
  for (const filed of filedTasks) {
    hosts.push(...(await filedHostsOf(filed)));
  }
  return unique(hosts);
}

function textOf(message: SessionMessage.WithParts): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

/** The host of a web page's address; empty for a blank page, a file, or no address at all. */
function webHostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.hostname
      : "";
  } catch {
    return "";
  }
}

/** Whether the chat's own agent is at work this moment. */
/**
 * How long a message with no reply yet counts as its turn starting. A message
 * is written before the agent it starts is running, so a list read between the
 * two would otherwise call the chat idle and show its last reply for a
 * moment; one that never starts an agent stops counting after this.
 */
const TURN_START_GRACE_MS = 30_000;

function chatIsAlive(sessionId: StoreId.Session): boolean {
  const taskId = chatOfSession(sessionId);
  if (!taskId) {
    return false;
  }
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
function turnIsStarting({ newestTurn }: ChatDigest): boolean {
  return (
    newestTurn?.role === "user" &&
    Date.now() - newestTurn.at < TURN_START_GRACE_MS
  );
}
