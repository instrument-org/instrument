import { err, ok, Result, safeTry } from "neverthrow";
import { alphabetical, parallel } from "radashi";

import { publisher } from "../rpc/publisher";
import { Session } from "../schemas/session";
import { SessionMessage } from "../schemas/session/message";
import { SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type AppConfig } from "./app-config/types";
import { TypedError } from "./errors";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";

export namespace Store {
  export function getAllMessageIds(
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

      const messageKeys = yield* storage.getKeys(StorageKey.MESSAGES_KEY, {
        signal,
      });

      const allMessageIds = messageKeys.map(StorageKey.extractMessageId);
      return ok(allMessageIds);
    });
  }

  export function getMessageIds(
    sessionId: StoreId.Session,
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

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
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const messageIdsResult = yield* getMessageIds(sessionId, appConfig, {
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

  export function getMessagesWithParts(
    {
      appConfig,
      messageIds,
      sessionId,
    }: {
      appConfig: AppConfig;
      messageIds?: StoreId.Message[];
      sessionId: StoreId.Session;
    },
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const messageIdsResult =
        messageIds ?? (yield* getMessageIds(sessionId, appConfig, { signal }));

      const messageResults = await parallel(
        { limit: 10, signal },
        alphabetical(messageIdsResult, (id) => id),
        async (messageId) => {
          return getMessageWithParts(
            { appConfig, messageId, sessionId },
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
      return Result.combine(found);
    });
  }

  export function getMessageWithParts(
    {
      appConfig,
      messageId,
      sessionId,
    }: {
      appConfig: AppConfig;
      messageId: StoreId.Message;
      sessionId: StoreId.Session;
    },
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

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
        appConfig,
        { signal },
      );

      return ok({ ...message, parts: partsResult });
    });
  }

  export function getPart(
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
    partId: StoreId.Part,
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);
      const part = yield* getParsedStorageItem(
        StorageKey.part(sessionId, messageId, partId),
        SessionMessagePart.CoercedSchema,
        storage,
        { signal },
      );
      return ok(part);
    });
  }

  export function getPartIds(
    sessionId: StoreId.Session,
    messageId: StoreId.Message,
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

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
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

      const partIdsResult = yield* getPartIds(sessionId, messageId, appConfig, {
        signal,
      });

      const partResults = await parallel(
        { limit: 10, signal },
        alphabetical(partIdsResult, (id) => id),
        async (partId) => {
          const partKey = StorageKey.part(sessionId, messageId, partId);
          return getParsedStorageItem(
            partKey,
            SessionMessagePart.CoercedSchema,
            storage,
            { signal },
          );
        },
      );

      return Result.combine(partResults);
    });
  }

  export function getSession(
    sessionId: StoreId.Session,
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

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
    appConfig: AppConfig,
    {
      includeChildSessions = false,
      signal,
    }: { includeChildSessions?: boolean; signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const sessionIds = yield* getStoreId(appConfig, { signal });

      const sessionResults = await parallel(
        { limit: 10, signal },
        alphabetical(sessionIds, (id) => id),
        async (sessionId) => {
          return getSession(sessionId, appConfig, { signal });
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
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

      const parseResult = yield* getParsedStorageItem(
        StorageKey.session(sessionId),
        Session.Schema,
        storage,
        { signal },
      );

      const messagesResult = yield* getMessagesWithParts(
        {
          appConfig,
          sessionId,
        },
        { signal },
      );

      return ok({ ...parseResult, messages: messagesResult });
    });
  }

  // Helper functions to retrieve IDs from storage keys
  export function getStoreId(
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

      const sessionKeys = yield* storage.getKeys(StorageKey.sessions(), {
        signal,
      });

      return ok(sessionKeys.map(StorageKey.extractSessionId));
    });
  }

  export function removeMessage(
    messageId: StoreId.Message,
    sessionId: StoreId.Session,
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

      const partIds = yield* getPartIds(sessionId, messageId, appConfig, {
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
        messageId,
        sessionId,
        subdomain: appConfig.subdomain,
      });
      return ok(undefined);
    });
  }

  export function removeSession(
    sessionId: StoreId.Session,
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const allSessions = yield* getSessions(appConfig, {
        includeChildSessions: true,
        signal,
      });
      const childSessions = allSessions.filter(
        (session) => session.parentId === sessionId,
      );

      for (const childSession of childSessions) {
        yield* removeSessionAndMessages(childSession.id, appConfig, { signal });
      }

      yield* removeSessionAndMessages(sessionId, appConfig, { signal });

      return ok(undefined);
    });
  }

  export function saveMessage(
    message: SessionMessage.Type,
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

      const savedMessage = yield* setParsedStorageItem(
        StorageKey.message(message.metadata.sessionId, message.id),
        message,
        SessionMessage.Schema,
        storage,
        { signal },
      );

      publisher.publish("message.updated", {
        messageId: savedMessage.id,
        sessionId: savedMessage.metadata.sessionId,
        subdomain: appConfig.subdomain,
      });

      return ok(savedMessage);
    });
  }

  export async function saveMessages(
    messages: SessionMessage.Type[],
    appConfig: AppConfig,
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
        return saveMessage(message, appConfig, { signal });
      },
    );

    return Result.combine(updateResults);
  }

  export function saveMessageWithParts(
    message: SessionMessage.WithParts,
    appConfig: AppConfig,
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
      yield* await saveParts(parts, appConfig, { publish: false, signal });
      // Save message - this will publish message.updated after everything is committed
      yield* saveMessage(rest, appConfig, { signal });
      // Now it's safe to publish part.updated for all parts
      for (const part of parts) {
        publisher.publish("part.updated", {
          part,
          subdomain: appConfig.subdomain,
        });
      }
      return ok(message);
    });
  }

  export function savePart(
    part: SessionMessagePart.Type,
    appConfig: AppConfig,
    {
      publish = true,
      signal,
    }: { publish?: boolean; signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

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
          part: savedPart,
          subdomain: appConfig.subdomain,
        });
      }

      return ok(savedPart);
    });
  }

  export async function saveParts(
    parts: SessionMessagePart.Type[],
    appConfig: AppConfig,
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
        return savePart(part, appConfig, { publish, signal });
      },
    );

    return Result.combine(updateResults);
  }

  export function saveSession(
    session: Session.Type,
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

      const savedSession = yield* setParsedStorageItem(
        StorageKey.session(session.id),
        session,
        Session.Schema,
        storage,
        { signal },
      );

      publisher.publish("session.updated", {
        sessionId: savedSession.id,
        subdomain: appConfig.subdomain,
      });

      return ok(savedSession);
    });
  }

  // Read-modify-write helper that re-loads the part from storage before
  // applying `updater`, so concurrent side-channel writes (e.g. browser
  // screenshot context items appended while a tool is executing) are not
  // clobbered by a stale in-memory snapshot held by the caller.
  export function updatePart(
    ids: {
      messageId: StoreId.Message;
      partId: StoreId.Part;
      sessionId: StoreId.Session;
    },
    updater: (part: SessionMessagePart.Type) => SessionMessagePart.Type,
    appConfig: AppConfig,
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
        appConfig,
        { signal },
      );
      const next = updater(current);
      if (next === current) {
        return ok(current);
      }
      const saved = yield* savePart(next, appConfig, { publish, signal });
      return ok(saved);
    });
  }

  // Insert or replace a context item on a tool part, keyed by `item.id`. The
  // item is appended on first write and replaced in place on subsequent
  // writes so callers can model lifecycle transitions (e.g. an agent-browser
  // observation moving from `pending` to `complete`) without producing a
  // second array entry for the same logical event. Order is preserved:
  // existing items keep their slot; new items are appended.
  export function upsertToolPartContextItem(
    ids: {
      messageId: StoreId.Message;
      partId: StoreId.Part;
      sessionId: StoreId.Session;
    },
    item: SessionMessagePart.ToolPartContextItem,
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return updatePart(
      ids,
      (part) => {
        // Only tool parts carry contextItems; ignore otherwise to avoid
        // accidentally mutating non-tool parts.
        if (
          part.type === "step-start" ||
          !("state" in part) ||
          (part.state !== "input-available" &&
            part.state !== "input-streaming" &&
            part.state !== "output-available" &&
            part.state !== "output-error")
        ) {
          return part;
        }
        const existing =
          ("contextItems" in part.metadata && part.metadata.contextItems) || [];
        const index = existing.findIndex((existingItem) => {
          return existingItem.id === item.id;
        });
        const next =
          index === -1
            ? [...existing, item]
            : existing.map((existingItem, i) =>
                i === index ? item : existingItem,
              );
        return {
          ...part,
          metadata: {
            ...part.metadata,
            contextItems: next,
          },
        } as SessionMessagePart.Type;
      },
      appConfig,
      { signal },
    );
  }

  function removeSessionAndMessages(
    sessionId: StoreId.Session,
    appConfig: AppConfig,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    return safeTry(async function* () {
      const storage = yield* getSessionsStoreStorage(appConfig);

      yield* storage.removeItem(StorageKey.session(sessionId), { signal });

      const messageIds = yield* getMessageIds(sessionId, appConfig, {
        signal,
      });
      for (const messageId of messageIds) {
        const partIds = yield* getPartIds(sessionId, messageId, appConfig, {
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
      }

      publisher.publish("session.removed", {
        sessionId,
        subdomain: appConfig.subdomain,
      });

      return ok(undefined);
    });
  }
}
