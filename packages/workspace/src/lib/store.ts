import { err, ok, Result, type ResultAsync, safeTry } from "neverthrow";
import { alphabetical, parallel } from "radashi";

import { publisher } from "../rpc/publisher";
import { Session } from "../schemas/session";
import { SessionMessage } from "../schemas/session/message";
import { SessionMessagePart } from "../schemas/session/message-part";
import { SessionMessageRelaxedPart } from "../schemas/session/message-relaxed-part";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { TypedError } from "./errors";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";

export namespace Store {
  export function getMessageIds(
    sessionId: StoreId.Session,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const messageKeys = yield* storage.getKeys(
        StorageKey.messages(sessionId),
        { signal },
      );

      return ok(messageKeys.map(StorageKey.extractMessageId));
    });
  }

  export function getMessageIdsAfter(
    sessionId: StoreId.Session,
    parentMessageId: StoreId.Message,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const messageIdsResult = yield* getMessageIds(sessionId, chatId, {
        signal,
      });
      const sortedMessageIds = alphabetical(messageIdsResult, (id) => id);

      const parentIndex = sortedMessageIds.indexOf(parentMessageId);
      if (parentIndex === -1) {
        return ok([]);
      }

      const messagesAfterParent = sortedMessageIds.slice(parentIndex + 1);
      return ok(messagesAfterParent);
    });
  }

  // Message records only, without their parts. Callers that just need message
  // metadata (usage, roles, timing) avoid reading and parsing every part, which
  // dominates a full session read.
  export function getMessages(
    {
      messageIds,
      sessionId,
      chatId,
    }: {
      messageIds?: StoreId.Message[];
      sessionId: StoreId.Session;
      chatId: ChatId;
    },
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);
      const messageIdsResult =
        messageIds ?? (yield* getMessageIds(sessionId, chatId, { signal }));

      const messageResults = await parallel(
        { limit: 10, signal },
        alphabetical(messageIdsResult, (id) => id),
        async (messageId) => {
          return getParsedStorageItem(
            StorageKey.message(sessionId, messageId),
            SessionMessage.Schema,
            storage,
            { signal },
          );
        },
      );

      // Skip transiently missing messages, matching getMessagesWithParts: the
      // index scan and individual fetches are not atomic.
      const found = messageResults.filter(
        (r) => !(r.isErr() && r.error.type === "workspace-not-found-error"),
      );
      return Result.combine(found);
    });
  }

  /**
   * A session's transcript, oldest first. A task's starts with what it
   * carries on from (`forkedAtMessageId`): its parent's messages up to that
   * one, read from the parent each time rather than copied, each still filed
   * under the parent's session. `inherited: false` reads the session's own
   * messages alone, as does naming `messageIds`.
   */
  export function getMessagesWithParts(
    {
      inherited = true,
      messageIds,
      sessionId,
      chatId,
    }: {
      inherited?: boolean;
      messageIds?: StoreId.Message[];
      sessionId: StoreId.Session;
      chatId: ChatId;
    },
    { signal }: { signal?: AbortSignal } = {},
  ): ResultAsync<
    SessionMessage.WithParts[],
    TypedError.NotFound | TypedError.Parse | TypedError.Storage
  > {
    return safeTry(async function* () {
      const forkedFrom =
        inherited && messageIds === undefined
          ? yield* forkPoint(sessionId, chatId, { signal })
          : undefined;
      const before = forkedFrom
        ? (yield* getMessagesWithParts(
            { sessionId: forkedFrom.parentId, chatId },
            { signal },
          )).filter((message) => message.id <= forkedFrom.messageId)
        : [];
      const messageIdsResult =
        messageIds ?? (yield* getMessageIds(sessionId, chatId, { signal }));

      const messageResults = await parallel(
        { limit: 10, signal },
        alphabetical(messageIdsResult, (id) => id),
        async (messageId) => {
          return getMessageWithParts(
            { messageId, sessionId, chatId },
            { signal },
          );
        },
      );

      // Skip transiently missing messages - the key index scan and individual
      // fetches are not atomic, so a message may appear in the index but not
      // yet be readable (or may have just been removed). The live query will
      // re-fetch on the next update event.
      const found = messageResults.filter(
        (r) => !(r.isErr() && r.error.type === "workspace-not-found-error"),
      );
      const own = yield* Result.combine(found);
      return ok(before.length > 0 ? [...before, ...own] : own);
    });
  }

  /**
   * Where a task's session carries on from its parent's, or nothing for a
   * session that starts from nothing of another's, one not saved yet among
   * them.
   */
  function forkPoint(
    sessionId: StoreId.Session,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal },
  ) {
    return getSession(sessionId, chatId, { signal })
      .map((session) =>
        session.parentId && session.forkedAtMessageId
          ? {
              messageId: session.forkedAtMessageId,
              parentId: session.parentId,
            }
          : undefined,
      )
      .orElse((error) =>
        error.type === "workspace-not-found-error" ? ok(undefined) : err(error),
      );
  }

  export function getMessageWithParts(
    {
      messageId,
      sessionId,
      chatId,
    }: {
      messageId: StoreId.Message;
      sessionId: StoreId.Session;
      chatId: ChatId;
    },
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const parseResult = yield* getParsedStorageItem(
        StorageKey.message(sessionId, messageId),
        SessionMessage.Schema,
        storage,
        { signal },
      );

      const message = parseResult;
      const partsResult = yield* getParts(
        message.metadata.sessionId,
        message.id,
        chatId,
        { signal },
      );

      return ok({ ...message, parts: partsResult });
    });
  }

  export function getPart(
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
    partId: StoreId.Part,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);
      const part = yield* getParsedStorageItem(
        StorageKey.part(sessionId, messageId, partId),
        SessionMessagePart.FromStorageSchema,
        storage,
        { signal },
      );
      return ok(part);
    });
  }

  export function getPartIds(
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const partKeys = yield* storage.getKeys(
        StorageKey.parts(sessionId, messageId),
        { signal },
      );

      return ok(partKeys.map(StorageKey.extractPartId));
    });
  }

  export function getParts(
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const partIdsResult = yield* getPartIds(sessionId, messageId, chatId, {
        signal,
      });

      const partResults = await parallel(
        { limit: 10, signal },
        alphabetical(partIdsResult, (id) => id),
        async (partId) => {
          const partKey = StorageKey.part(sessionId, messageId, partId);
          return getParsedStorageItem(
            partKey,
            SessionMessageRelaxedPart.Schema,
            storage,
            { signal },
          );
        },
      );

      const relaxedParts = yield* Result.combine(partResults);

      return ok(relaxedParts.map((part) => SessionMessagePart.coerce(part)));
    });
  }

  export function getSession(
    sessionId: StoreId.Session,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const parseResult = yield* getParsedStorageItem(
        StorageKey.session(sessionId),
        Session.Schema,
        storage,
        { signal },
      );

      return ok(parseResult);
    });
  }

  export function getSessions(
    chatId: ChatId,
    {
      includeChildSessions = false,
      signal,
    }: { includeChildSessions?: boolean; signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const sessionIds = yield* getStoreId(chatId, { signal });

      const sessionResults = await parallel(
        { limit: 10, signal },
        alphabetical(sessionIds, (id) => id),
        async (sessionId) => {
          return getSession(sessionId, chatId, { signal });
        },
      );

      const sessions = yield* Result.combine(sessionResults);

      if (includeChildSessions) {
        return ok(sessions);
      }

      return ok(sessions.filter((session) => !session.parentId));
    });
  }

  export function getSessionWithMessagesAndParts(
    sessionId: StoreId.Session,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const parseResult = yield* getParsedStorageItem(
        StorageKey.session(sessionId),
        Session.Schema,
        storage,
        { signal },
      );

      const messagesResult = yield* getMessagesWithParts(
        {
          sessionId,
          chatId,
        },
        { signal },
      );

      return ok({ ...parseResult, messages: messagesResult });
    });
  }

  // Helper functions to retrieve IDs from storage keys
  export function getStoreId(
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const sessionKeys = yield* storage.getKeys(StorageKey.sessions(), {
        signal,
      });

      return ok(sessionKeys.map(StorageKey.extractSessionId));
    });
  }

  export function removeMessage(
    messageId: StoreId.Message,
    sessionId: StoreId.Session,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const partIds = yield* getPartIds(sessionId, messageId, chatId, {
        signal,
      });
      for (const partId of partIds) {
        yield* storage.removeItem(
          StorageKey.part(sessionId, messageId, partId),
          { signal },
        );
      }
      yield* storage.removeItem(StorageKey.message(sessionId, messageId), {
        signal,
      });
      publisher.publish("message.removed", {
        id: chatId,
        messageId,
        sessionId,
      });
      return ok(undefined);
    });
  }

  export function saveMessage(
    message: SessionMessage.Type,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const savedMessage = yield* setParsedStorageItem(
        StorageKey.message(message.metadata.sessionId, message.id),
        message,
        SessionMessage.Schema,
        storage,
        { signal },
      );

      publisher.publish("message.updated", {
        id: chatId,
        messageId: savedMessage.id,
        sessionId: savedMessage.metadata.sessionId,
      });

      return ok(savedMessage);
    });
  }

  export async function saveMessages(
    messages: SessionMessage.Type[],
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    const [firstMessage, ...rest] = messages;
    if (firstMessage) {
      const firstSessionId = firstMessage.metadata.sessionId;
      const messagesWithSessionMismatch = rest.filter(
        (message) => message.metadata.sessionId !== firstSessionId,
      );

      if (messagesWithSessionMismatch.length > 0) {
        return err(
          new TypedError.Conflict(
            `Some messages do not belong to session ${firstSessionId}: ${messagesWithSessionMismatch.map((m) => m.id).join(", ")}`,
          ),
        );
      }
    }

    const updateResults = await parallel(
      { limit: 10, signal },
      messages,
      async (message) => {
        return saveMessage(message, chatId, { signal });
      },
    );

    return Result.combine(updateResults);
  }

  export function saveMessageWithParts(
    message: SessionMessage.WithParts,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const partsWithSessionMismatch = message.parts.filter(
        (part) => part.metadata.sessionId !== message.metadata.sessionId,
      );

      if (partsWithSessionMismatch.length > 0) {
        return err(
          new TypedError.Conflict(
            `Some parts do not belong to session ${message.metadata.sessionId}: ${partsWithSessionMismatch.map((p) => p.metadata.id).join(", ")}`,
          ),
        );
      }

      const partsWithMessageMismatch = message.parts.filter(
        (part) => part.metadata.messageId !== message.id,
      );

      if (partsWithMessageMismatch.length > 0) {
        return err(
          new TypedError.Conflict(
            `Some parts do not belong to message ${message.id}: ${partsWithMessageMismatch.map((p) => p.metadata.id).join(", ")}`,
          ),
        );
      }

      const { parts, ...rest } = message;
      // Save parts first without publishing part.updated events to avoid race condition
      // where live queries try to read the message before it's saved
      yield* await saveParts(parts, chatId, { publish: false, signal });
      // Save message - this will publish message.updated after everything is committed
      yield* saveMessage(rest, chatId, { signal });
      // Now it's safe to publish part.updated for all parts
      for (const part of parts) {
        publisher.publish("part.updated", {
          id: chatId,
          part,
        });
      }
      return ok(message);
    });
  }

  export function savePart(
    part: SessionMessagePart.Type,
    chatId: ChatId,
    {
      publish = true,
      signal,
    }: { publish?: boolean; signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const savedPart = yield* setParsedStorageItem(
        StorageKey.part(
          part.metadata.sessionId,
          part.metadata.messageId,
          part.metadata.id,
        ),
        part,
        SessionMessagePart.CoercedSchema,
        storage,
        { signal },
      );

      if (publish) {
        publisher.publish("part.updated", {
          id: chatId,
          part: savedPart,
        });
      }

      return ok(savedPart);
    });
  }

  export async function saveParts(
    parts: SessionMessagePart.Type[],
    chatId: ChatId,
    {
      publish = true,
      signal,
    }: { publish?: boolean; signal?: AbortSignal } = {},
  ) {
    const [firstPart] = parts;
    if (firstPart) {
      const firstSessionId = firstPart.metadata.sessionId;
      for (const part of parts) {
        if (part.metadata.sessionId !== firstSessionId) {
          return err(
            new TypedError.Conflict(
              `Part ${part.metadata.id} does not belong to session ${firstSessionId}`,
            ),
          );
        }
      }

      const firstMessageId = firstPart.metadata.messageId;
      for (const part of parts) {
        if (part.metadata.messageId !== firstMessageId) {
          return err(
            new TypedError.Conflict(
              `Part ${part.metadata.id} does not belong to message ${firstMessageId}`,
            ),
          );
        }
      }
    }

    const updateResults = await parallel(
      { limit: 10, signal },
      parts,
      async (part) => {
        return savePart(part, chatId, { publish, signal });
      },
    );

    return Result.combine(updateResults);
  }

  export function saveSession(
    session: Session.Type,
    chatId: ChatId,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(chatId);

      const savedSession = yield* setParsedStorageItem(
        StorageKey.session(session.id),
        session,
        Session.Schema,
        storage,
        { signal },
      );

      return ok(savedSession);
    });
  }

  // Read-modify-write helper that re-loads the part from storage before
  // applying `updater`, so concurrent updates are not clobbered by a stale
  // in-memory snapshot held by the caller.
  export function updatePart(
    ids: {
      messageId: StoreId.Message;
      partId: StoreId.Part;
      sessionId: StoreId.Session;
    },
    updater: (part: SessionMessagePart.Type) => SessionMessagePart.Type,
    chatId: ChatId,
    {
      publish = true,
      signal,
    }: { publish?: boolean; signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const current = yield* getPart(
        ids.sessionId,
        ids.messageId,
        ids.partId,
        chatId,
        { signal },
      );
      const next = updater(current);
      if (next === current) {
        return ok(current);
      }
      const saved = yield* savePart(next, chatId, { publish, signal });
      return ok(saved);
    });
  }
}
