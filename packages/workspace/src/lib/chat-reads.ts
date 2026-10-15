import { okAsync, ResultAsync } from "neverthrow";

import { type ChatId } from "../schemas/chat-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { TypedError } from "./errors";
import { type ChatRead, writingChatRecords } from "./records/chat-records";
import { sessionOf } from "./records/session-of";
import {
  conversationView,
  liveView,
  mergeViews,
  messageIdsView,
  modelHistoryView,
  type Said,
  saidIn,
  searchView,
  stepsView,
} from "./records/views";
import { Store } from "./store";
import { getWorkspaceConfig, hasWorkspaceConfig } from "./workspace-config";

/**
 * What a reader takes from a chat while its records are written beside the
 * store: the records' own views where the records hold the chat, and the
 * store where they do not.
 *
 * The records hold a chat once they hold a message of it. Everything else
 * reads the store: a process that writes no records at all (a script, a test
 * that has not asked for them), and a chat an earlier build wrote, whose
 * records carry a header and the person's marks and no message until the
 * converter has run over it.
 *
 * The gate is the chat rather than the session, since both sides are written
 * for every session of a chat at once, and a task reads its chat's messages
 * before its own. What a running turn holds in memory is outside the gate:
 * it is this process's own, and stands over the written messages whichever
 * side wrote them.
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
    signal,
    usable,
  }: {
    chatId: ChatId;
    inherited?: boolean;
    sessionId: StoreId.Session;
    signal?: AbortSignal;
    /** The window the request is being built for, which retires a boundary drawn under a smaller one. */
    usable?: number;
  }): ResultAsync<SessionMessage.WithParts[], Failure> {
    return recorded(chatId).andThen((records) =>
      records?.held
        ? ResultAsync.fromPromise(
            modelHistoryView(records.read, sessionId, { inherited, usable }),
            storageError,
          )
        : Store.getMessagesWithParts(
            { chatId, inherited, sessionId },
            { signal },
          ),
    );
  }

  /**
   * The ids of the session's messages, oldest first: for a reader that only
   * has to place a message among them.
   */
  export function messageIds({
    chatId,
    inherited,
    sessionId,
    signal,
  }: {
    chatId: ChatId;
    inherited?: boolean;
    sessionId: StoreId.Session;
    signal?: AbortSignal;
  }): ResultAsync<StoreId.Message[], Failure> {
    return recorded(chatId).andThen((records) =>
      records?.held
        ? okAsync(messageIdsView(records.read, sessionId, { inherited }))
        : Store.getMessageIds(sessionId, chatId, { signal }).map((ids) =>
            ids.toSorted(byId),
          ),
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
    signal,
  }: {
    bytes?: boolean;
    chatId: ChatId;
    inherited?: boolean;
    only?: ReadonlySet<StoreId.Message>;
    sessionId: StoreId.Session;
    signal?: AbortSignal;
  }): ResultAsync<SessionMessage.WithParts[], Failure> {
    return recorded(chatId).andThen((records) => {
      // The running turn is this process's own memory, so it stands over
      // what was written whichever side wrote it.
      const live = records
        ? liveView(records.read, sessionId, { only })
        : undefined;
      if (!records?.held) {
        return Store.getMessagesWithParts(
          {
            chatId,
            inherited,
            ...(only && { messageIds: [...only] }),
            sessionId,
          },
          { signal },
        ).map((written) =>
          live?.length ? mergeViews(written, live) : written,
        );
      }
      const options = { inherited, only };
      return ResultAsync.fromPromise(
        stepsView(records.read, sessionId, { ...options, bytes }).then(
          (steps) =>
            mergeViews(
              conversationView(records.read, sessionId, options),
              steps,
              live ?? [],
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
    signal,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
    signal?: AbortSignal;
  }): ResultAsync<Said[], Failure> {
    return recorded(chatId).andThen((records) =>
      records?.held
        ? okAsync(searchView(records.read, sessionId))
        : Store.getMessagesWithParts({ chatId, sessionId }, { signal }).map(
            (messages) => saidIn(messages.toSorted((a, b) => byId(a.id, b.id))),
          ),
    );
  }

  /**
   * The session as its callers have always read one: its title, the person's
   * marks, where its context window was reset and who stopped its turn.
   */
  export function session({
    chatId,
    sessionId,
    signal,
  }: {
    chatId: ChatId;
    sessionId: StoreId.Session;
    signal?: AbortSignal;
  }): ResultAsync<Session.Type, Failure> {
    return recorded(chatId).andThen((records) => {
      const found = records?.held
        ? records.read.chat.sessions.find(({ id }) => id === sessionId)
        : undefined;
      return found
        ? okAsync(sessionOf(found))
        : Store.getSession(sessionId, chatId, { signal });
    });
  }
}

/** What a read of a chat fails with, whichever side holds it. */
type Failure = TypedError.NotFound | TypedError.Parse | TypedError.Storage;

/**
 * The chat as its records stand, and whether they are what holds it: `held`
 * is false for a chat whose messages are still the store's, whose running
 * turn this process holds all the same. Nothing at all where this process
 * writes no records, or their read failed, which is reported and answered
 * from the store, since the store is written for every chat.
 */
function recorded(
  chatId: ChatId,
): ResultAsync<{ held: boolean; read: ChatRead } | undefined, Failure> {
  const records = writingChatRecords();
  if (!records) {
    return okAsync(undefined);
  }
  return ResultAsync.fromSafePromise(
    records
      .read(chatId)
      .then((read) => ({
        held: read.chat.sessions.some((each) => each.messages.length > 0),
        read,
      }))
      .catch((error: unknown) => {
        report(error);
        return undefined;
      }),
  );
}

function report(error: unknown): void {
  if (hasWorkspaceConfig()) {
    getWorkspaceConfig().captureException(error, { scopes: ["workspace"] });
  }
}

function storageError(error: unknown): TypedError.Storage {
  return new TypedError.Storage(
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

function byId(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
