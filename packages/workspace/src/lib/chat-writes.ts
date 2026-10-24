import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { type Stopper } from "../schemas/stop-notice";

import { type ChatId } from "../schemas/chat-id";
import { type Session } from "../schemas/session";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { TypedError } from "./errors";
import { isArriving } from "./records/arriving";
import {
  type ChatRecords,
  type SettingChange,
  writingChatRecords,
} from "./records/chat-records";

/**
 * What a chat is written through: its records, and nothing beside them.
 *
 * The counterpart of {@link ChatReads}, and the reason it is a module of its
 * own rather than more of `StoreRecords`: an append through `StoreRecords` is
 * deliberately something nobody waits on, because the store write it followed
 * had already landed, so a failed append cost a line in the log and no data.
 * With the store gone that reasoning goes with it. A write nobody waits on is
 * a message the person sent and the chat does not have, so every function
 * here waits for its append and hands back what failed.
 *
 * The shapes match what the store's writers answered, so a caller moves
 * across by changing the name it calls.
 */
export namespace ChatWrites {
  /**
   * The session's row: its header the first time, its changes after.
   * `startedAs` is the title a new session's header starts it as, when that
   * is not its row's title.
   */
  export function saveSession(
    session: Session.Type,
    chatId: ChatId,
    startedAs?: string,
  ): ResultAsync<Session.Type, TypedError.Storage> {
    return records(chatId).andThen((writing) =>
      wrote(writing.saveSession(chatId, session, startedAs), session),
    );
  }

  /** A message with no parts of its own yet, or one whose metadata changed. */
  export function saveMessage(
    message: SessionMessage.Type,
    chatId: ChatId,
  ): ResultAsync<SessionMessage.Type, TypedError.Storage> {
    return records(chatId).andThen((writing) =>
      wrote(writing.appendMessage(chatId, message), message),
    );
  }

  /**
   * A message and its parts as one commit, which every read of the records
   * then sees together: what a turn's first message and a task's delivery
   * are written as.
   */
  export function saveMessageWithParts(
    message: SessionMessage.WithParts,
    chatId: ChatId,
  ): ResultAsync<SessionMessage.WithParts, TypedError.Storage> {
    return records(chatId).andThen((writing) =>
      wrote(writing.appendMessageWithParts(chatId, message), message),
    );
  }

  /**
   * One part, at whatever state it has reached: a record once it has
   * settled, and until then the turn's own, held in memory where every read
   * of the chat sees it. So a reply's text is written once, when it is whole,
   * however many deltas it arrived in.
   */
  export function savePart(
    part: SessionMessagePart.Type,
    chatId: ChatId,
  ): ResultAsync<SessionMessagePart.Type, TypedError.Storage> {
    return records(chatId).andThen((writing) => {
      const turn = writing.live(chatId, part.metadata.sessionId);
      if (isArriving(part)) {
        turn.setPart(part);
        return okAsync(part);
      }
      return wrote(turn.settle(part), part);
    });
  }

  /**
   * Hands `change` the part as it stands, pending writes included, and writes
   * what it gives back, in the same tick: two changes asked for together each
   * build on the other, so a guard in the second sees the first. Nothing for
   * a part the chat does not have, which is a caller racing a retraction
   * rather than an error.
   */
  export function updatePart(
    ids: {
      chatId: ChatId;
      messageId: StoreId.Message;
      partId: StoreId.Part;
      sessionId: StoreId.Session;
    },
    change: (part: SessionMessagePart.Type) => SessionMessagePart.Type,
  ): ResultAsync<SessionMessagePart.Type | undefined, TypedError.Storage> {
    const { chatId, ...part } = ids;
    return records(chatId).andThen((writing) =>
      ResultAsync.fromPromise(
        writing.updatePart(chatId, part, change),
        storageError,
      ),
    );
  }

  /** The hosts the session's browser has been on now, the whole list. */
  export function sites(
    chatId: ChatId,
    sessionId: StoreId.Session,
    visited: string[],
  ): ResultAsync<void, TypedError.Storage> {
    return records(chatId).andThen((writing) =>
      wrote(writing.sites(chatId, sessionId, visited), undefined),
    );
  }

  /**
   * One of the session's settings, in this device's settings file. A value
   * the session already has writes nothing.
   */
  export function setting(
    chatId: ChatId,
    sessionId: StoreId.Session,
    change: SettingChange,
  ): ResultAsync<void, TypedError.Storage> {
    return records(chatId).andThen((writing) =>
      wrote(writing.setting(chatId, sessionId, change), undefined),
    );
  }

  /**
   * That the session's turn was stopped, and by whom, at `at` (the moment
   * the stop was asked for). It holds until a turn starts after it.
   */
  export function stopped(
    chatId: ChatId,
    sessionId: StoreId.Session,
    by: Stopper,
    at: Date,
  ): ResultAsync<void, TypedError.Storage> {
    return records(chatId).andThen((writing) =>
      wrote(writing.stopped(chatId, sessionId, by, at), undefined),
    );
  }

  /**
   * Resolves once every write of the chat already asked for has landed or
   * failed: what a turn ends on, so whatever hears it is over reads all of
   * it from the chat's files.
   */
  export function landed(chatId: ChatId): Promise<void> {
    return writingChatRecords()?.landed(chatId) ?? Promise.resolve();
  }

  /**
   * Writes what the session's turn still holds in memory as cut off: a
   * reply's words as they stood, and a call still arriving as interrupted.
   * For a turn whose writer is gone.
   */
  export function cutOffTurn(
    chatId: ChatId,
    sessionId: StoreId.Session,
  ): Promise<void> {
    return (
      writingChatRecords()?.live(chatId, sessionId).clear() ?? Promise.resolve()
    );
  }

  /** A message taken out of its session, with its parts. */
  export function retract(
    chatId: ChatId,
    sessionId: StoreId.Session,
    messageIds: StoreId.Message[],
  ): ResultAsync<void, TypedError.Storage> {
    return records(chatId).andThen((writing) =>
      wrote(writing.retract(chatId, sessionId, messageIds), undefined),
    );
  }
}

/**
 * The records this process writes. A process with none in place cannot hold
 * a chat at all, which every caller here is told rather than left to assume:
 * what used to be the store's answer is now nobody's.
 */
function records(chatId: ChatId): ResultAsync<ChatRecords, TypedError.Storage> {
  const writing = writingChatRecords();
  return writing
    ? okAsync(writing)
    : errAsync(
        new TypedError.Storage(
          `No records are in place to write chat ${chatId} to`,
        ),
      );
}

/** An append waited for, answering with what was written. */
function wrote<T>(
  appended: Promise<unknown>,
  written: T,
): ResultAsync<T, TypedError.Storage> {
  return ResultAsync.fromPromise(appended, storageError).map(() => written);
}

function storageError(error: unknown): TypedError.Storage {
  return new TypedError.Storage(
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}
