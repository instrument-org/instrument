import { APP_NAME_SLUG, placeholderTitle } from "@instrument-org/shared";
import { parallel, unique } from "radashi";
import { z } from "zod";

import { publisher } from "../../rpc/publisher";
import { type Session } from "../../schemas/session";
import { SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { listApps } from "../apps/store";
import { getBrowserState } from "../browser-state";
import { isUntitledChatSessionTitle } from "../generate-session-title";
import { pathsNamedInMessage } from "../paths-named-in-message";
import { sessionOfChat } from "../record-folders";
import { Store } from "../store";
import { getWorkspaceConfig } from "../workspace-config";
import { indexedByStore, kept, unkept } from "../workspace-index";
import { askIn, type ChatActivity, chatActivity, isWorking } from "./activity";
import { listChatIds } from "./chat-records";
import { chatConversation, listChildTasks } from "./children";
import { joinedMidTurn } from "./mid-turn";
import { latestStepIn } from "./step-label";
import { excerptOf } from "./standing";
import { listTopics } from "./topics";
import { hasPendingWake } from "./wake";
import { createWriteQueue } from "../create-write-queue";

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
  /** When the chat began: its first message, or the session itself before one. */
  createdAt: z.number(),
  /**
   * What the chat has made and used, read out of what was said in it and
   * out of the tasks filed from it. Best effort: a source that is expensive
   * to read may leave its list empty.
   */
  holds: z.object({
    /** App slugs the chat called, then those the user sent from. */
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
  /**
   * The chat's own record, which its transcript and its tasks are under, and
   * how the window and the agent name it (its tabs' group, its address, a
   * link to it).
   */
  id: ChatIdSchema,
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
  /** The user's first message, whatever it carried; absent only before one is saved. */
  root: SessionMessage.UserSchemaWithParts.optional(),
  /** The tasks filed from this chat that are at work right now. */
  runningTasks: z.array(
    z.object({
      /** The task's session in the chat's store, which is its id. */
      id: StoreId.SessionSchema,
      step: z.string().optional(),
      title: z.string(),
      /** What it has stopped to ask the user for; present while it is stalled on that rather than moving. */
      waiting: z.string().optional(),
    }),
  ),
  /** The chat's session, which its transcript is read and its messages are sent through. */
  sessionId: StoreId.SessionSchema,
  /**
   * Working while the chat's own agent is alive or a task filed from it is
   * moving; waiting while a task filed from it is stopped on an ask, or its
   * own last turn ended on one; failed while its last turn ended in an error
   * and nothing has been said since; idle otherwise.
   */
  state: z.enum(["failed", "idle", "waiting", "working"]),
  title: z.string(),
  /**
   * Whether the agent has named the chat. Until it has, `title` is the
   * ask's own first words, which a row need not repeat under the ask.
   */
  titled: z.boolean(),
  /** Topic ids, from the session record. */
  topics: z.array(z.string()),
  /** Whether something in the chat has not been looked at: the mark on its session record. */
  unread: z.boolean(),
  /** Whether the user set that mark themselves, which holds until they come back to the chat. */
  unreadByUser: z.boolean(),
  /** When anything last happened in it, in ms. */
  updatedAt: z.number(),
});

export type Chat = z.output<typeof ChatSchema>;

/** One queue per chat for the marks the user puts on its session record. */
const markQueue = createWriteQueue();

/** What every chat of a conversation is read against, loaded once per list. */
interface Shared {
  /** The apps the workspace has, so a hold names only a real one. */
  knownApps: Set<string>;
}

/**
 * Puts a chat away. The list still carries it, marked, and its stamp stays
 * where it was: putting a chat away is not something happening in it.
 */
export async function archiveChat(chatId: ChatId): Promise<boolean> {
  return saveArchivedAt(chatId, new Date());
}

/** One chat, or none for an id that is not a chat's. */
export async function chatById(chatId: ChatId): Promise<Chat | undefined> {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    return undefined;
  }
  const digest = await chatDigest(chatId, sessionId);
  if (!digest || digest.session.parentId) {
    return undefined;
  }
  return chatFor(digest, chatId, await loadShared());
}

/**
 * Whether anything of the chat's is still moving: its own agent, or a task
 * filed from it that is not stopped on an ask. A chat that is not has
 * settled, and the next move is the user's.
 */
export async function chatIsWorking(chatId: ChatId): Promise<boolean> {
  if (chatIsAlive(chatId)) {
    return true;
  }
  const { running } = await chatActivity(chatId);
  return running.some((task) => !task.waiting);
}

/**
 * Every chat, oldest first.
 *
 * Each chat is a record of its own holding one session, and it is a chat
 * once the user has opened it with a message; one with no such message (made
 * by a send that failed partway, say) is left out.
 */
export async function listChats(): Promise<Chat[]> {
  const ids = listChatIds();
  const rows = await listedChats(ids);
  return ids.flatMap((id) => rows.get(id) ?? []);
}

/**
 * The rows of the chats named, as `listChats` would list them, read against
 * one load of what every row shares: a chat it would leave out has no row.
 * What the live list reads again for the chats a change moved.
 */
export async function listedChats(
  ids: readonly ChatId[],
): Promise<Map<ChatId, Chat>> {
  const shared = await loadShared();
  const rows = await parallel({ limit: READ_LIMIT }, ids, async (chatId) => {
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      return;
    }
    const digest = await chatDigest(chatId, sessionId);
    return digest ? chatFor(digest, chatId, shared) : undefined;
  });
  return new Map(
    rows.flatMap((row): [ChatId, Chat][] =>
      row === undefined ? [] : [[row.id, row]],
    ),
  );
}

/**
 * Why `listChats` leaves a chat with a session out, or none when it lists it.
 * A chat whose digest is kept answers from it without opening its store.
 */
export async function chatReadProblem(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<"unreadable-messages" | "unreadable-session" | undefined> {
  if (await chatDigest(chatId, sessionId)) {
    return undefined;
  }
  const session = await Store.getSession(sessionId, chatId);
  return session.isErr() ? "unreadable-session" : "unreadable-messages";
}

/** Takes the unread mark off a chat: the user has looked at it, or said they have. */
export async function markChatRead(chatId: ChatId): Promise<boolean> {
  return saveMark(chatId, (session) => {
    if (session.unreadAt === undefined) {
      return session;
    }
    const { unreadAt: _at, unreadByUser: _byUser, ...rest } = session;
    return rest;
  });
}

/**
 * Puts the unread mark on a chat: the chat settling with something new, or
 * the user marking it unread. Any chat can carry one, whatever it holds. A
 * mark already on keeps its date, and one the user set stays theirs, so the
 * chat settling under it cannot make it one that clears on sight.
 */
export async function markChatUnread(
  chatId: ChatId,
  { byUser }: { byUser: boolean },
): Promise<boolean> {
  return saveMark(chatId, (session) => ({
    ...session,
    unreadAt: session.unreadAt ?? new Date(),
    ...(byUser || session.unreadByUser ? { unreadByUser: true } : {}),
  }));
}

/**
 * Marks a chat unread each time it settles: its agent and every task filed
 * from it have stopped, whether on a reply, a question, or an error. A turn
 * that leaves something of the chat's still working waits for the one that
 * settles it, the same moment its title is settled and a notification
 * treats as news. A chat the user is looking at as it settles is marked
 * too; the window takes the mark off again at once.
 */
export function startChatUnreadOnSettle(): void {
  void (async () => {
    for await (const { id, sessionId } of publisher.subscribe("session.done")) {
      try {
        // A task's turn ending is news the chat's own next reply carries.
        const chatId = chatConversation(id, sessionId);
        if (chatId && !(await chatIsWorking(chatId))) {
          await markChatUnread(chatId, { byUser: false });
        }
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}

/**
 * Names a chat the way the user typed it, which settles its title: the
 * app never renames a chat the user has named.
 */
export async function renameChat(
  chatId: ChatId,
  title: string,
): Promise<boolean> {
  return saveMark(chatId, (session) => ({
    ...session,
    title,
    titleSettledAt: new Date(),
  }));
}

/** Stars a chat, or takes the star off. The stamp stays where it was, as with putting a chat away. */
export async function setChatStarred(
  chatId: ChatId,
  starred: boolean,
): Promise<boolean> {
  return saveMark(chatId, (session) => {
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
  chatId: ChatId,
  topics: string[],
): Promise<boolean> {
  const known = new Set((await listTopics()).map((topic) => topic.id));
  return saveMark(chatId, (session) => ({
    ...session,
    topics: unique(topics.filter((id) => known.has(id))),
  }));
}

/** Records that the app is done naming a chat, leaving any rename after it to the user. */
export async function settleChatTitle(chatId: ChatId): Promise<boolean> {
  return saveMark(chatId, (session) => ({
    ...session,
    titleSettledAt: new Date(),
  }));
}

/** Brings a chat back into the inbox. */
export async function unarchiveChat(chatId: ChatId): Promise<boolean> {
  return saveArchivedAt(chatId, undefined);
}

/**
 * The hosts a task's session has visited, held until its chat's store is
 * written: the browser records a visit there and announces nothing.
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
  /** Whether the chat's last turn ended in an error with nothing said after it. */
  failed: boolean;
  /** The newest user or assistant message's role and time, which says whether a turn is starting. */
  newestTurn?: { at: number; role: "assistant" | "user" };
  openedHosts: string[];
  /** What the chat's own last turn asked the user, if it ended on an ask. */
  ownAsk?: string;
  root?: SessionMessage.UserWithParts;
  sent: ReturnType<typeof sentHeld>;
  session: Session.Type;
  /** The last reply with words: when it finished and its first line. */
  spoken?: { at: number; text: string };
  /** The step the chat's current turn is on, from its own calls since the user's newest message. */
  stepInTurn?: string;
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
  filed: ChatActivity["running"],
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
  taskId: ChatId,
  shared: Shared,
): Promise<Chat> {
  const { root, session } = digest;
  const filedTasks = (await listChildTasks(taskId)).map((task) => task.id);
  const { running: filed } = await chatActivity(taskId);
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
  const ownWorking =
    (chatIsAlive(taskId) && digest.ownAsk === undefined) ||
    turnIsStarting(digest);
  const working =
    ownWorking || filed.some((task) => !task.waiting) || hasPendingWake(taskId);
  const ask = working ? undefined : askOf(digest, filed);
  const state = working
    ? "working"
    : ask
      ? "waiting"
      : digest.failed
        ? "failed"
        : "idle";

  const lead = runningTasks.find((task) => !task.waiting);
  const latest = latestFor({
    ask,
    digest,
    // The chat's own turn names its step first, as the line under its title
    // does; a task at work, its step or else its name.
    step:
      (ownWorking ? digest.stepInTurn : undefined) ?? lead?.step ?? lead?.title,
    state,
  });

  const { sent } = digest;
  const made = {
    apps: unique(knownAmong(digest.calledApps, shared.knownApps)),
    files: digest.madeFiles,
    sites: await sitesHeld(taskId, digest.openedHosts, filedTasks),
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
    id: taskId,
    starred: session.starredAt !== undefined,
    ...(digest.lastAsk ? { lastAsk: digest.lastAsk } : {}),
    ...(latest ? { latest } : {}),
    ...(digest.lastReplyAt === undefined
      ? {}
      : { lastReplyAt: digest.lastReplyAt }),
    ...(root ? { root } : {}),
    runningTasks,
    sessionId: session.id,
    state,
    // Until the agent names the chat, the ask's own first words stand for it
    // rather than the placeholder a session is born with.
    title: isUntitledChatSessionTitle(session.title)
      ? placeholderTitle(firstLine(root ? textOf(root) : "")) || session.title
      : session.title,
    titled: !isUntitledChatSessionTitle(session.title),
    topics: session.topics ?? [],
    unread: session.unreadAt !== undefined,
    unreadByUser: session.unreadByUser === true,
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
  taskId: ChatId,
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
  // Only this turn's calls, so a new turn never names the last one's step;
  // a message that joined the turn under way does not start one.
  const turnStart = messages.findLastIndex(
    (message) => message.role === "user" && !joinedMidTurn(message),
  );
  const stepInTurn = latestStepIn(messages.slice(turnStart + 1));
  const lastMessageAt = messages.at(-1)?.metadata.createdAt.getTime();
  const lastReplyAt = replies.at(-1)?.metadata.finishedAt?.getTime();
  // The last thing the agent did ended in an error, after the user's
  // newest message: a turn that never got its reply out. A retry that went
  // on to answer, or anything the user sends after, leaves it behind.
  const failed =
    lastAssistant !== undefined &&
    messages.lastIndexOf(lastAssistant) >
      (lastUser ? messages.lastIndexOf(lastUser) : -1) &&
    (lastAssistant.metadata.error !== undefined ||
      lastAssistant.metadata.finishReason === "error");
  return {
    calledApps: commands.flatMap(appSlugsIn),
    ...(lastAssistant && {
      lastAssistantAt: lastAssistant.metadata.createdAt.getTime(),
    }),
    failed,
    lastAsk: lastUser ? firstLine(textOf(lastUser)) : "",
    ...(lastMessageAt !== undefined && { lastMessageAt }),
    ...(lastReplyAt !== undefined && { lastReplyAt }),
    madeFiles: filesHeld(messages),
    ...(newestTurn && {
      newestTurn: {
        at: newestTurn.metadata.createdAt.getTime(),
        role: newestTurn.role,
      },
    }),
    openedHosts: commands.flatMap(openedHostsIn),
    ...(ownAsk !== undefined && { ownAsk }),
    ...(root && { root }),
    sent: sentHeld(messages),
    session,
    ...(spoken?.role === "assistant" && {
      spoken: {
        at: (spoken.metadata.finishedAt ?? spoken.metadata.createdAt).getTime(),
        text: firstLine(textOf(spoken)),
      },
    }),
    ...(stepInTurn !== undefined && { stepInTurn }),
  };
}

function filedHostsOf(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<string[]> {
  return filedHosts(
    chatId,
    async () => {
      const browser = await getBrowserState(chatId, sessionId);
      return browser.isOk()
        ? kept(browser.value?.visitedHosts ?? [])
        : unkept([]);
    },
    sessionId,
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
  state,
  step,
}: {
  ask: undefined | { at: number; text: string };
  digest: ChatDigest;
  state: Chat["state"];
  /** What a working chat is on: the step its own turn or a task at work names. */
  step: string | undefined;
}): Chat["latest"] {
  if (state === "working") {
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
  return { knownApps: await knownAppSlugs() };
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
  chatId: ChatId,
  archivedAt: Date | undefined,
): Promise<boolean> {
  return saveMark(chatId, (session) => {
    const { archivedAt: _was, ...rest } = session;
    return { ...rest, ...(archivedAt ? { archivedAt } : {}) };
  });
}

/**
 * Writes a mark of the user's onto the chat's session record, announcing the
 * change so the live list re-reads. Marks on one chat queue behind each
 * other, so a star and a rename landing together each build on the other.
 */
function saveMark(
  chatId: ChatId,
  mark: (session: Session.Type) => Session.Type,
): Promise<boolean> {
  return markQueue(chatId, async () => {
    const sessionId = sessionOfChat(chatId);
    if (!sessionId) {
      return false;
    }
    const session = await Store.getSession(sessionId, chatId);
    if (session.isErr()) {
      return false;
    }
    const saved = await Store.saveSession(mark(session.value), chatId);
    return saved.isOk();
  });
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
      // A page chipped beside the thing in view went with the message too.
      for (const chip of viewed.attached ?? []) {
        const chipHost = chip.kind === "page" ? webHostOf(chip.url) : "";
        if (chipHost !== "" && chipHost !== host) {
          sites.push(chipHost);
        }
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
 * with `tab open <url>`, then every host the browsers of the tasks it started
 * have been on, each task's newest last. A task's hosts come from its browser
 * state, one small read per task, rather than from its transcript.
 */
async function sitesHeld(
  chatId: ChatId,
  openedHosts: string[],
  filedTasks: StoreId.Session[],
): Promise<string[]> {
  const hosts = [...openedHosts];
  for (const filed of filedTasks) {
    hosts.push(...(await filedHostsOf(chatId, filed)));
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

function chatIsAlive(chatId: ChatId): boolean {
  const sessionId = sessionOfChat(chatId);
  return sessionId !== undefined && isWorking(chatId, sessionId);
}

/** The newest message is the user's or a wake's, recent, and not yet answered. */
function turnIsStarting({ newestTurn }: ChatDigest): boolean {
  return (
    newestTurn?.role === "user" &&
    Date.now() - newestTurn.at < TURN_START_GRACE_MS
  );
}
