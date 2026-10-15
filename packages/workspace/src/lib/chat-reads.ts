import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { type z } from "zod";

import { type ChatId } from "../schemas/chat-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { TypedError } from "./errors";
import { type ChatRead, writingChatRecords } from "./records/chat-records";
import { type ToldWhat } from "./records/record";
import { sessionOf } from "./records/session-of";
import {
  toldView,
  contextTokensView,
  conversationView,
  everyMessageView,
  listView,
  liveView,
  mergeViews,
  messageIdsView,
  modelHistoryView,
  type Said,
  searchView,
  stepsView,
} from "./records/views";

/**
 * What a reader takes from a chat: the views over its records, and nothing
 * else. The counterpart of {@link ChatWrites}.
 *
 * Every read is of the chat rather than of one session, since a chat is one
 * fold and a task reads its chat's messages before its own. What a running
 * turn holds in memory is read with them: it is this process's own, and
 * stands over what has been written.
 */
export namespace ChatReads {
  /**
   * The session's history as the model is sent it: every message, with the
   * bytes its calls returned read back from the blobs that hold them in the
   * messages inside the window `usable` tokens leave. `inherited: false`
   * reads the session's own messages alone, without those a task carries on
   * from its chat.
   */
  export function modelHistory({
    chatId,
    inherited,
    sessionId,
    usable,
  }: {
    chatId: ChatId;
    inherited?: boolean;
    sessionId: StoreId.Session;
    /** The window the request is being built for, which retires a boundary drawn under a smaller one. */
    usable?: number;
  }): ResultAsync<SessionMessage.WithParts[], Failure> {
    return read(chatId).andThen((chat) =>
      ResultAsync.fromPromise(
        modelHistoryView(chat, sessionId, { inherited, usable }),
        storageError,
      ),
    );
  }

  /**
   * The ids of the session's own messages, oldest first: for a reader that
   * only has to place a message among them, or count them. A task's carry
   * none of its chat's, which is what tells an empty task from a started
   * one.
   */
  export function messageIds({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<StoreId.Message[], Failure> {
    return read(chatId).map((chat) =>
      messageIdsView(chat, sessionId, { inherited: false }),
    );
  }

  /**
   * The session's transcript as it stands: what the chat view draws for
   * everyone, the steps behind it, and the parts the running turn holds over
   * both, which is how a call still arriving is read.
   *
   * `only` reads the named messages alone, for a reader following a change
   * to them. `bytes` is for a reader that shows what a call returned, and
   * reads those bytes back from the blobs that hold them; a reader that does
   * not show them spends no read on one.
   */
  export function transcript({
    bytes = false,
    chatId,
    inherited,
    only,
    sessionId,
  }: {
    bytes?: boolean;
    chatId: ChatId;
    inherited?: boolean;
    only?: ReadonlySet<StoreId.Message>;
    sessionId: StoreId.Session;
  }): ResultAsync<SessionMessage.WithParts[], Failure> {
    return read(chatId).andThen((chat) => {
      const options = { inherited, only };
      return ResultAsync.fromPromise(
        stepsView(chat, sessionId, { ...options, bytes }).then((steps) =>
          mergeViews(
            conversationView(chat, sessionId, options),
            steps,
            // The running turn is this process's own memory, and stands over
            // what has been written.
            liveView(chat, sessionId, { only }),
          ),
        ),
        storageError,
      );
    });
  }

  /**
   * What the person and the agent said in the session, in words, oldest
   * first: what the chat's own search reads.
   */
  export function said({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<Said[], Failure> {
    return read(chatId).map((chat) => searchView(chat, sessionId));
  }

  /**
   * What the session's context meter shows: the input tokens the last reply
   * that reported any was built from.
   */
  export function contextTokens({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<number, Failure> {
    return read(chatId).map((chat) => contextTokensView(chat, sessionId));
  }

  /**
   * What the session was last told of one standing fact: the folders it can
   * reach, the apps it is connected to, the browser's tabs, the memories it
   * was given, the processes it left running. Each is written as a record
   * when it changes, and read back here to be compared with what holds now,
   * so the agent is told only the difference.
   */
  export function told<Schema extends z.ZodType>({
    chatId,
    schema,
    sessionId,
    what,
  }: {
    chatId: ChatId;
    schema: Schema;
    sessionId: StoreId.Session;
    what: ToldWhat;
  }): ResultAsync<undefined | z.output<Schema>, Failure> {
    return read(chatId).map((chat) => {
      const held = toldView(chat, sessionId, what);
      if (held === undefined || held === null) {
        return undefined;
      }
      const parsed = schema.safeParse(held);
      // A fact this build cannot read is one the agent is told again in
      // full, which is what a missing one does: the record stays as written.
      return parsed.success ? parsed.data : undefined;
    });
  }

  /**
   * The chat's sessions: its own conversation, and with
   * `includeChildSessions` the tasks it has started too.
   */
  export function sessions({
    chatId,
    includeChildSessions = false,
  }: {
    chatId: ChatId;
    includeChildSessions?: boolean;
  }): ResultAsync<Session.Type[], Failure> {
    return read(chatId).map((chat) =>
      listView(chat).filter((each) => includeChildSessions || !each.parentId),
    );
  }

  /**
   * The session with every message and every part it holds: what a saved or
   * copied transcript carries.
   */
  export function sessionWithMessages({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<Session.WithMessagesAndParts, Failure> {
    return read(chatId).andThen((chat) => {
      const found = chat.chat.sessions.find(({ id }) => id === sessionId);
      if (!found) {
        return errAsync(missingSession(chatId, sessionId));
      }
      return ResultAsync.fromPromise(
        everyMessageView(chat, sessionId).then((messages) => ({
          ...sessionOf(found),
          messages,
        })),
        storageError,
      );
    });
  }

  /**
   * The session as its callers have always read one: its title, the person's
   * marks, where its context window was reset and who stopped its turn.
   */
  export function session({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<Session.Type, Failure> {
    return read(chatId).andThen((chat) => {
      const found = chat.chat.sessions.find(({ id }) => id === sessionId);
      return found
        ? okAsync(sessionOf(found))
        : errAsync(missingSession(chatId, sessionId));
    });
  }
}

/** What a read of a chat fails with. */
type Failure = TypedError.NotFound | TypedError.Parse | TypedError.Storage;

/**
 * The chat as its records stand, with the writes still on their way to disk
 * over the fold and the running turn beside it. A process with no records in
 * place holds no chat at all, which every reader here is told rather than
 * left to assume.
 */
function read(chatId: ChatId): ResultAsync<ChatRead, Failure> {
  const records = writingChatRecords();
  if (!records) {
    return errAsync(
      new TypedError.Storage(`No records are in place to read chat ${chatId}`),
    );
  }
  return ResultAsync.fromPromise(records.read(chatId), storageError);
}

function missingSession(
  chatId: ChatId,
  sessionId: StoreId.Session,
): TypedError.NotFound {
  return new TypedError.NotFound(`Chat ${chatId} has no session ${sessionId}`);
}

function storageError(error: unknown): TypedError.Storage {
  return new TypedError.Storage(
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}
