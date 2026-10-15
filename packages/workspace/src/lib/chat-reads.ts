import { okAsync, ResultAsync } from "neverthrow";

import { type ChatId } from "../schemas/chat-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";
import { TypedError } from "./errors";
import { type ChatRead, writingChatRecords } from "./records/chat-records";
import { sessionOf } from "./records/session-of";
import { messageIdsView, modelHistoryView } from "./records/views";
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
 * before its own.
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
    return recorded(chatId).andThen((read) =>
      read
        ? ResultAsync.fromPromise(
            modelHistoryView(read, sessionId, { inherited, usable }),
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
    return recorded(chatId).andThen((read) =>
      read
        ? okAsync(messageIdsView(read, sessionId, { inherited }))
        : Store.getMessageIds(sessionId, chatId, { signal }).map((ids) =>
            ids.toSorted(byId),
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
    return recorded(chatId).andThen((read) => {
      const found = read?.chat.sessions.find(({ id }) => id === sessionId);
      return found
        ? okAsync(sessionOf(found))
        : Store.getSession(sessionId, chatId, { signal });
    });
  }
}

/** What a read of a chat fails with, whichever side holds it. */
type Failure = TypedError.NotFound | TypedError.Parse | TypedError.Storage;

/**
 * The chat as its records hold it, or nothing where the store is what holds
 * it. A records read that fails is reported and answered from the store,
 * which is still written for every chat.
 */
function recorded(chatId: ChatId): ResultAsync<ChatRead | undefined, Failure> {
  const records = writingChatRecords();
  if (!records) {
    return okAsync(undefined);
  }
  return ResultAsync.fromSafePromise(
    records
      .read(chatId)
      .then((read) =>
        read.chat.sessions.some((each) => each.messages.length > 0)
          ? read
          : undefined,
      )
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
