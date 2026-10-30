import { errAsync, okAsync, ResultAsync } from "neverthrow";

import { type ChatId } from "../schemas/chat-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { TypedError } from "./errors";
import { type ChatRead, writingChatRecords } from "./records/chat-records";
import { type FoldedSession, type FoldedSettings } from "./records/fold";
import { sessionOf } from "./records/session-of";
import {
  sitesView,
  contextTokensView,
  conversationView,
  everyMessageView,
  listView,
  liveView,
  mergeViews,
  messageIdsView,
  historyView,
  modelHistoryView,
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
   * messages inside the window `model` is sent. `inherited: false`
   * reads the session's own messages alone, without those a task carries on
   * from its chat.
   */
  export function modelHistory({
    chatId,
    inherited,
    model,
    sessionId,
  }: {
    chatId: ChatId;
    inherited?: boolean;
    /** The canonical id of the model the request is for, whose recorded verdict may lift the boundary. */
    model?: string;
    sessionId: StoreId.Session;
  }): ResultAsync<SessionMessage.WithParts[], Failure> {
    return read(chatId).andThen((chat) =>
      ResultAsync.fromPromise(
        modelHistoryView(chat, sessionId, { inherited, model }),
        storageError,
      ),
    );
  }

  /**
   * The session's history as it is stored, with no blob read back: where a
   * reader finds what the session was last told (`last-told.ts`).
   */
  export function history({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<SessionMessage.WithParts[], Failure> {
    return read(chatId).map((chat) => historyView(chat, sessionId));
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

  /** The hosts the session's browser has been on, oldest first: the sites its work used. */
  export function sites({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<string[], Failure> {
    return read(chatId).map((chat) => sitesView(chat, sessionId));
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
   * The session's settings as they stand: the newest of each across every
   * device's settings file, with this device's writes still on their way
   * over them. The chat's own session's are the chat's (its model).
   */
  export function settings({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<FoldedSettings, Failure> {
    return read(chatId).andThen((chat) => {
      const found = chat.chat.sessions.find(({ id }) => id === sessionId);
      return found
        ? okAsync(found.settings)
        : errAsync(missingSession(chatId, sessionId));
    });
  }

  /**
   * The session's newest stop, who asked for it and when, whether or not a
   * turn has started since: a reader that measures against its own idea of a
   * turn's start compares the time itself.
   */
  export function stopped({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<FoldedSession["stopped"], Failure> {
    return read(chatId).andThen((chat) => {
      const found = chat.chat.sessions.find(({ id }) => id === sessionId);
      return found
        ? okAsync(found.stopped)
        : errAsync(missingSession(chatId, sessionId));
    });
  }

  /**
   * The permission cards in the session's log, each as it was last written,
   * and every answer to them from every device, in log order: what
   * `openCardsIn` reads the open cards from.
   */
  export function cards({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<Required<Pick<FoldedSession, "answers" | "cards">>, Failure> {
    return read(chatId).andThen((chat) => {
      const found = chat.chat.sessions.find(({ id }) => id === sessionId);
      return found
        ? okAsync({ answers: found.answers ?? [], cards: found.cards ?? [] })
        : errAsync(missingSession(chatId, sessionId));
    });
  }

  /** The app version that began the session, from the header of its first log. */
  export function startedWithApp({
    chatId,
    sessionId,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
  }): ResultAsync<string, Failure> {
    return read(chatId).andThen((chat) => {
      const found = chat.chat.sessions.find(({ id }) => id === sessionId);
      return found
        ? okAsync(found.app)
        : errAsync(missingSession(chatId, sessionId));
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
