import { APP_NAME_SLUG } from "@instrument-org/shared";
import { type Stopper } from "../../schemas/stop-notice";
import { parallel, unique } from "radashi";
import { z } from "zod";

import { publisher } from "../../rpc/publisher";
import { type Ask, type QuestionAsk } from "../../schemas/chat-state";
import { type Session } from "../../schemas/session";
import { SessionMessage } from "../../schemas/session/message";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { StoreId } from "../../schemas/store-id";
import { type ChatId, ChatIdSchema } from "../../schemas/chat-id";
import { ChatReads } from "../chat-reads";
import { listApps } from "../apps/store";
import { ChatWrites } from "../chat-writes";
import { cappedTitle } from "../chat-folders/folder-name";
import { isUntitledChatSessionTitle } from "../generate-session-title";
import { pathsNamedInMessage } from "../paths-named-in-message";
import { cardLine, openPermissionAsks, sortAsks } from "./asks";
import { openQuestionsIn } from "./open-asks";
import { sessionOfChat } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { indexedByRecords, kept, unkept } from "../workspace-index";
import {
  type ChatActivity,
  chatActivity,
  isWorking,
  liveMessages,
} from "./activity";
import { listChatIds } from "./chat-records";
import { listChildTasks, sessionRole } from "./children";
import { joinedMidTurn } from "./mid-turn";
import { latestStepIn } from "./step-label";
import { shownTitle } from "./shown-title";
import { excerptOf } from "./standing";
import { listTopics } from "./topics";
import { hasWakeOnItsWay } from "./wake-queue";
import { isStopNote } from "./wake-event";
import { chatStateOf } from "./chat-state";
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
  /**
   * The chat's own newest labeled step, and when the message holding it was
   * sent: what its line says it last did once it is at rest.
   */
  lastStep: z.object({ at: z.number(), text: z.string() }).optional(),
  /** When the user last sent a message, in ms, wake notes aside; the chat's creation before one is saved. */
  lastUserMessageAt: z.number(),
  /** The step the chat's own turn is on, while it has one; never a task's. */
  ownStep: z.string().optional(),
  /** Whether the chat's own session has a turn under way, whatever its tasks do. */
  ownWorking: z.boolean(),
  /** The user's first message, whatever it carried; absent only before one is saved. */
  root: SessionMessage.UserSchemaWithParts.optional(),
  /** The tasks filed from this chat that are at work right now. */
  runningTasks: z.array(
    z.object({
      /** The task's session in the chat's store, which is its id. */
      id: StoreId.SessionSchema,
      step: z.string().optional(),
      title: z.string(),
    }),
  ),
  /** The chat's session, which its transcript is read and its messages are sent through. */
  sessionId: StoreId.SessionSchema,
  /** Where the chat stands, by the one rule in `chatStateOf`. */
  state: z.enum(["failed", "idle", "limited", "stopped", "waiting", "working"]),
  /**
   * While `state` is `limited`, what stopped the turn: a plan the account
   * does not have (`plan`, Instrument's refusal for a missing or lapsed
   * plan), a plan whose last payment failed (`payment`), or a usage window
   * spent (`usage`).
   */
  stoppedFor: z.enum(["payment", "plan", "usage"]).optional(),
  title: z.string(),
  /**
   * Whether the agent has named the chat. Until it has, `title` is the
   * ask's own first words, which a row need not repeat under the ask.
   */
  titled: z.boolean(),
  /**
   * Whether the title's words are the name the app gave the chat rather than
   * one the user typed, which the window sweeps in when it changes on screen.
   */
  titleByApp: z.boolean(),
  /** The topic's id, from the session record; absent when it is filed under none. */
  topic: z.string().optional(),
  /** Whether something in the chat has not been looked at: the mark on its session record. */
  unread: z.boolean(),
  /** Whether the user set that mark themselves, which holds until they come back to the chat. */
  unreadByUser: z.boolean(),
  /** When anything last happened in it, in ms. */
  updatedAt: z.number(),
  /**
   * Whether anything of the chat's still moves, by the same rule, whatever
   * `state` says: a card can wait on the user while a task of its works.
   * What reads the chat as settled or busy reads this, not `state`.
   */
  working: z.boolean(),
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
 * Whether anything of the chat's is still moving, by the rule its row
 * follows. A chat that is not has settled, and the next move is the user's.
 */
export async function chatIsWorking(chatId: ChatId): Promise<boolean> {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    return false;
  }
  const digest = await chatDigest(chatId, sessionId);
  if (!digest) {
    return false;
  }
  const { running } = await chatActivity(chatId);
  // Whether anything moves does not turn on what waits on the user, so the
  // chat's cards are not read.
  return stateOf(chatId, digest, running, []).working;
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
  const session = await ChatReads.session({ chatId, sessionId });
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
 * the person stopped is no news to them, so it leaves the mark as it was. A turn
 * that leaves something of the chat's still working waits for the one that
 * settles it, the same moment its title is settled and a notification
 * treats as news. A chat the user is looking at as it settles is marked
 * too; the window takes the mark off again at once.
 */
export function startChatUnreadOnSettle(): void {
  void (async () => {
    for await (const { id, notice, sessionId } of publisher.subscribe(
      "session.done",
    )) {
      try {
        // A task's turn ending is news the chat's own next reply carries.
        if (
          notice?.by !== "person" &&
          sessionRole(id, sessionId) === "chat" &&
          !(await chatIsWorking(id))
        ) {
          await markChatUnread(id, { byUser: false });
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
    title: cappedTitle(title),
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
 * Files a chat under a topic, by id, or under none with `null`. An id the
 * workspace has no topic for files it under none, so the record never
 * names a topic that was never made.
 */
export async function setChatTopic(
  chatId: ChatId,
  topicId: null | string,
): Promise<boolean> {
  const known = (await listTopics()).some((topic) => topic.id === topicId);
  return saveMark(chatId, (session) => {
    const { topic: _was, ...rest } = session;
    return { ...rest, ...(known && topicId ? { topic: topicId } : {}) };
  });
}

/**
 * Records that the user stopped the chat's own turn at `at`, the moment they
 * pressed Stop, as a `stop` record in its session's log: the chat reads as
 * stopped until a turn starts after it. A user's stop already there from
 * that moment on (the turn's own, saved as it ended) is that stop, and
 * nothing more is written (`ChatRecords.stopped` checks that as it writes).
 */
export async function markChatStopped(
  chatId: ChatId,
  at: Date,
): Promise<boolean> {
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    return false;
  }
  const written = await ChatWrites.stopped(chatId, sessionId, "person", at);
  return written.isOk();
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
 * The hosts a task's session has visited, held until its session is
 * written: the browser records a visit there and announces nothing.
 */
const filedHosts = indexedByRecords<string[]>("task_hosts");

/**
 * What a chat's row is made from that its own store holds: its session
 * record and what its messages say, boiled down to what the row reads. Kept
 * in the workspace index, so a chat whose store has not changed since the
 * last launch draws its row without its transcript being read.
 */
interface ChatDigest {
  /** Commands' `instrument app call` and `instrument app request` slugs. */
  calledApps: string[];
  lastAsk: string;
  lastMessageAt?: number;
  lastReplyAt?: number;
  lastUserMessageAt?: number;
  madeFiles: string[];
  /** Whether the chat's last turn ended in an error with nothing said after it. */
  failed: boolean;
  /** Whether that error was a usage limit, which `failed` then leaves out. */
  limited: boolean;
  /**
   * Whether that limit was Instrument's refusal for a plan rather than a
   * spent window, and whether the plan was missing or its payment failed.
   */
  planRefusal?: "payment" | "plan";
  openedHosts: string[];
  root?: SessionMessage.UserWithParts;
  sent: ReturnType<typeof sentHeld>;
  session: Session.Type;
  /** The last reply with words: when it finished and its first line. */
  spoken?: { at: number; text: string };
  /** The chat's own newest labeled step, in any turn, and when its message was sent. */
  lastStep?: { at: number; text: string };
  /** The questions the chat's agent asked that are still open (`openQuestionsIn`). */
  questions: QuestionAsk[];
  /** The step the chat's current turn is on, from its own calls since the newest message that started a turn. */
  stepInTurn?: string;
  /** Whether the user stopped the chat's own turn, and no turn has started since. */
  stopped: boolean;
}

/**
 * The app slugs a shell command calls or asks the user to connect: `instrument app call`
 * or `instrument app request` where a command begins, followed by a slug's own letters.
 * Anchored to the command's start and to a slug's shape so the same words
 * inside a brief's prose ("keep the app request intact.") name nothing.
 */
function appSlugsIn(command: string): string[] {
  return [
    ...command.matchAll(
      /(?:^|[\n;&|]|\$\()\s*instrument\s+app\s+(?:call|request)\s+([a-z0-9][a-z0-9_-]*)\b/g,
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
 * Everything the chat waits on the user for, each with when it was asked,
 * oldest first: its open cards and questions.
 */
function asksOf(cards: Ask[]): { at: number; text: string }[] {
  return cards.map((card) => ({
    at: card.askedAt.getTime(),
    text: cardLine(card),
  }));
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
  chatId: ChatId,
  shared: Shared,
): Promise<Chat> {
  const { root, session } = digest;
  const filedTasks = (await listChildTasks(chatId)).map((task) => task.id);
  const { running: filed } = await chatActivity(chatId);
  const runningTasks = filed.map((task) => ({
    id: task.sessionId,
    ...(task.step ? { step: task.step } : {}),
    title: task.title,
  }));

  const {
    ask: anyAsk,
    ownWorking,
    state,
    working,
  } = stateOf(
    chatId,
    digest,
    filed,
    sortAsks([...(await openPermissionAsks(chatId)), ...digest.questions]),
  );
  const ask = state === "working" ? undefined : anyAsk;

  const [lead] = runningTasks;
  // A turn under way names its step from what it holds in memory, where a
  // call whose input is still arriving is; the written step stands for it
  // otherwise, and a turn that has ended names none.
  const ownStep = ownWorking
    ? (latestStepIn(await liveMessages({ chatId, sessionId: session.id })) ??
      digest.stepInTurn)
    : undefined;
  const latest = latestFor({
    ask,
    digest,
    // The chat's own turn names its step first, as the line under its title
    // does; a task at work, its step or else its name.
    step: ownStep ?? lead?.step ?? lead?.title,
    state,
  });

  const { sent } = digest;
  const made = {
    apps: unique(knownAmong(digest.calledApps, shared.knownApps)),
    files: digest.madeFiles,
    sites: await sitesHeld(chatId, digest.openedHosts, filedTasks),
  };

  const createdAt = (root?.metadata.createdAt ?? session.createdAt).getTime();
  return {
    archived: session.archivedAt !== undefined,
    createdAt,
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
    id: chatId,
    starred: session.starredAt !== undefined,
    ...(digest.lastAsk ? { lastAsk: digest.lastAsk } : {}),
    ...(latest ? { latest } : {}),
    ...(digest.lastReplyAt === undefined
      ? {}
      : { lastReplyAt: digest.lastReplyAt }),
    ...(digest.lastStep ? { lastStep: digest.lastStep } : {}),
    lastUserMessageAt: digest.lastUserMessageAt ?? createdAt,
    ...(ownStep ? { ownStep } : {}),
    ownWorking,
    ...(state === "limited" && {
      stoppedFor: digest.planRefusal ?? ("usage" as const),
    }),
    ...(root ? { root } : {}),
    runningTasks,
    sessionId: session.id,
    state,
    title: shownTitle(session.title, root),
    titleByApp: session.titleByApp === true,
    titled: !isUntitledChatSessionTitle(session.title),
    ...(session.topic ? { topic: session.topic } : {}),
    unread: session.unreadAt !== undefined,
    unreadByUser: session.unreadByUser === true,
    // When anything last happened: the session's own stamp moves when a turn
    // starts, so a reply landing later and the line it is peeked by count too.
    updatedAt: Math.max(
      (session.updatedAt ?? session.createdAt).getTime(),
      digest.lastReplyAt ?? 0,
      latest?.at ?? 0,
    ),
    working,
  };
}

/** Each chat's digest, kept until its own session changes. */
const chatDigests = indexedByRecords<ChatDigest | undefined>("chat_digests");

/** A chat's digest, or none when its record or its messages cannot be read. */
function chatDigest(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<ChatDigest | undefined> {
  return chatDigests(chatId, sessionId, async () => {
    const session = await ChatReads.session({ chatId, sessionId });
    if (session.isErr()) {
      return unkept(undefined);
    }
    const messages = await ChatReads.transcript({ chatId, sessionId });
    const stop = await ChatReads.stopped({ chatId, sessionId });
    return messages.isOk() && stop.isOk()
      ? kept(digestOf(session.value, messages.value, stop.value))
      : unkept(undefined);
  });
}

function digestOf(
  session: Session.Type,
  messages: SessionMessage.WithParts[],
  /** The session's newest stop, whatever came after it. */
  stop: { at: Date; by: Stopper } | undefined,
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
  const lastUser = messages.findLast((message) => message.role === "user");
  // The newest message that started a turn of the chat's own, which every
  // reading of where its turn stands is measured from.
  const lastOpener = messages.findLast(startsTurn);
  // A wake note is written as a user message but carries only task, app,
  // or background-process news; everything else the user sent, asks on a
  // file alone included.
  const lastUserMessage = messages.findLast(
    (message) =>
      message.role === "user" &&
      !message.parts.every(
        (part) =>
          part.type === "data-taskEvent" ||
          part.type === "data-appEvent" ||
          part.type === "data-jobEvent",
      ),
  );
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
  // Only this turn's calls, so a new turn never names the last one's step.
  const stepInTurn = latestStepIn(
    messages.slice(lastOpener ? messages.lastIndexOf(lastOpener) + 1 : 0),
  );
  const lastStep = lastStepIn(messages);
  const lastMessageAt = messages.at(-1)?.metadata.createdAt.getTime();
  const lastReplyAt = replies.at(-1)?.metadata.finishedAt?.getTime();
  // Whether the last thing the agent did, after the newest message that
  // started a turn, ended in an error: a turn that never got its reply out.
  // A retry that went on to answer, or anything sent after that starts a
  // turn, leaves it behind. A reply cut off is an error only when its
  // request timed out: any other stop was asked for, and one cut off before
  // the reason was kept says nothing either way.
  const endsLastTurn =
    lastAssistant !== undefined &&
    messages.lastIndexOf(lastAssistant) >
      (lastOpener ? messages.lastIndexOf(lastOpener) : -1);
  const error = lastAssistant?.metadata.error;
  const endedInError =
    endsLastTurn &&
    (error === undefined
      ? lastAssistant.metadata.finishReason === "error"
      : error.kind !== "aborted" || error.reason === "timeout");
  // A plan or usage window that ran out stopped the turn without anything
  // going wrong, so it is told apart from a failure.
  const limited =
    endedInError &&
    error !== undefined &&
    "classification" in error &&
    error.classification === "usage-limit";
  const failed = endedInError && !limited;
  // Instrument refusing a turn for want of a plan reads as a usage limit to
  // the provider error classifier; its own code tells the two apart.
  const planRefusal =
    limited && "responseBody" in error
      ? planRefusalOf(error.responseBody)
      : undefined;
  // The user's Stop, rather than what it left behind: a turn stopped before
  // it began left only the message no turn took up, and one stopped between
  // steps left nothing at all.
  const stopped =
    stop?.by === "person" &&
    (lastOpener === undefined || stop.at >= lastOpener.metadata.createdAt);
  return {
    calledApps: commands.flatMap(appSlugsIn),
    failed,
    lastAsk: lastUser ? firstLine(textOf(lastUser)) : "",
    ...(lastMessageAt !== undefined && { lastMessageAt }),
    ...(lastReplyAt !== undefined && { lastReplyAt }),
    ...(lastUserMessage && {
      lastUserMessageAt: lastUserMessage.metadata.createdAt.getTime(),
    }),
    limited,
    madeFiles: filesHeld(messages),
    ...(planRefusal && { planRefusal }),
    openedHosts: commands.flatMap(openedHostsIn),
    ...(root && { root }),
    sent: sentHeld(messages),
    session,
    ...(spoken?.role === "assistant" && {
      spoken: {
        at: (spoken.metadata.finishedAt ?? spoken.metadata.createdAt).getTime(),
        text: firstLine(textOf(spoken)),
      },
    }),
    ...(lastStep && { lastStep }),
    questions: openQuestionsIn(messages, stop),
    ...(stepInTurn !== undefined && { stepInTurn }),
    stopped,
  };
}

function filedHostsOf(
  chatId: ChatId,
  sessionId: StoreId.Session,
): Promise<string[]> {
  return filedHosts(chatId, sessionId, async () => {
    const sites = await ChatReads.sites({ chatId, sessionId });
    return sites.isOk() ? kept(sites.value) : unkept([]);
  });
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

/** The newest labeled step in a transcript, and when the message holding it was sent. */
function lastStepIn(
  messages: SessionMessage.WithParts[],
): { at: number; text: string } | undefined {
  for (const message of messages.toReversed()) {
    const text = latestStepIn([message]);
    if (text !== undefined) {
      return { at: message.metadata.createdAt.getTime(), text };
    }
  }
  return undefined;
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
 * The hostnames a shell command opens for the user with `instrument window
 * show <url>`.
 */
function openedHostsIn(command: string): string[] {
  const hosts: string[] = [];
  // `show` opens every address it is given, each in a tab of its own.
  for (const match of command.matchAll(
    /(?:^|[\n;&|])\s*instrument\s+window\s+show\s([^\n;&|]*)/g,
  )) {
    for (const [url] of (match[1] ?? "").matchAll(/https?:\/\/[^\s'"]+/g)) {
      try {
        hosts.push(new URL(url).hostname);
      } catch {
        // Not an address the shell would have opened either.
      }
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
    const session = await ChatReads.session({ chatId, sessionId });
    if (session.isErr()) {
      return false;
    }
    const saved = await ChatWrites.saveSession(mark(session.value), chatId);
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
 * with `instrument window show <url>`, then every host the browsers of the tasks it started
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

/**
 * Where a chat stands by `chatStateOf`, read from its digest, the tasks
 * running in it, and its open cards, with what its line says it waits on
 * the user for.
 */
function stateOf(
  chatId: ChatId,
  digest: ChatDigest,
  running: ChatActivity["running"],
  cards: Ask[],
) {
  const asks = asksOf(cards);
  const askedAt = asks.length
    ? Math.max(...asks.map((ask) => ask.at))
    : undefined;
  return {
    ask: asks[0],
    ...chatStateOf({
      askedAt,
      failed: digest.failed,
      limited: digest.limited,
      ownTurn: hasOwnTurn(chatId),
      spokeAt: digest.lastUserMessageAt ?? 0,
      stopped: digest.stopped,
      tasksAtWork: running.length > 0,
      wakeOnItsWay: hasWakeOnItsWay(chatId),
    }),
  };
}

/**
 * Whether the chat's own session has a turn this moment. Its agent is alive
 * from the moment a message reaches the session, which a sender does as it
 * writes the message, until the turn that message starts has ended.
 */
function hasOwnTurn(chatId: ChatId): boolean {
  const sessionId = sessionOfChat(chatId);
  return sessionId !== undefined && isWorking(chatId, sessionId);
}

/**
 * Whether a message started a turn of the chat's own: one the user sent, or
 * a wake's. One that joined a turn already under way started none, and nor
 * did a note a stop left, which wakes nothing.
 */
function startsTurn(message: SessionMessage.WithParts): boolean {
  return (
    message.role === "user" && !isStopNote(message) && !joinedMidTurn(message)
  );
}

/**
 * Whether a refused request's body is Instrument's `subscription-required`,
 * which is not a usage window running out: `payment` when the account's plan
 * is held up by a failed payment, `plan` when it has no plan or trial that
 * covers the request.
 */
function planRefusalOf(responseBody: unknown) {
  if (typeof responseBody !== "string") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(responseBody);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("error" in parsed) ||
      typeof parsed.error !== "object" ||
      parsed.error === null ||
      !("code" in parsed.error) ||
      parsed.error.code !== "subscription-required"
    ) {
      return undefined;
    }
    return "reason" in parsed.error && parsed.error.reason === "payment-failed"
      ? ("payment" as const)
      : ("plan" as const);
  } catch {
    return undefined;
  }
}
