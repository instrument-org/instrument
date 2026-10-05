import { ok, safeTry } from "neverthrow";
import { z } from "zod";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { isConnected } from "./apps/connection";
import { listApps } from "./apps/store";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";
import { getWorkspaceConfig } from "./workspace-config";

const ChatAppsBaselineSchema = z.record(
  z.string(),
  z.object({
    connected: z.boolean(),
    name: z.string(),
    web: z.string().optional(),
  }),
);

type ChatAppsBaseline = z.output<typeof ChatAppsBaselineSchema>;

/** The workspace's apps as a chat's agent is told about them: each one's name and whether it is connected. */
export async function currentChatApps(): Promise<ChatAppsBaseline> {
  const { apps: config, appsDir } = getWorkspaceConfig();
  const { apps } = await listApps(appsDir);
  const connections = await config.connections.list();
  return Object.fromEntries(
    apps.map((app) => [
      app.slug,
      {
        connected: isConnected(connections[app.slug], app.manifestHash),
        name: app.manifest.name,
        ...(app.manifest.type === "web" ? { web: app.manifest.url } : {}),
      },
    ]),
  );
}

/** Records the apps as the chat's agent now knows them, so the next message diffs from here. */
export function setChatAppsBaseline(
  taskId: TaskId,
  sessionId: StoreId.Session,
  apps: ChatAppsBaseline,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const storage = yield* getSessionsStoreStorage(taskId);
    yield* setParsedStorageItem(
      StorageKey.chatAppsBaseline(sessionId),
      apps,
      ChatAppsBaselineSchema,
      storage,
      { signal },
    );
    return ok(undefined);
  });
}

/**
 * Diffs the workspace's apps against what the chat's agent last heard, then
 * advances the baseline. Returns a `data-appEvent` part, marked as carried on
 * the user's message, for the apps connected, disconnected, or removed since;
 * undefined where there is no baseline yet or nothing changed.
 *
 * The standing list is in the session context, written once. A change the
 * user makes outside the conversation (a disconnect or a removal on the
 * app's page) must not wake the chat and start work nobody asked for, so it
 * waits here for the next thing the user writes.
 */
export function detectChatAppChanges({
  messageId,
  sessionId,
  signal,
  taskId,
}: {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: TaskId;
}) {
  return safeTry<SessionMessagePart.Type | undefined, Error>(
    async function* () {
      const storage = yield* getSessionsStoreStorage(taskId);
      const stored = await getParsedStorageItem(
        StorageKey.chatAppsBaseline(sessionId),
        ChatAppsBaselineSchema,
        storage,
        { signal },
      );
      const current = await currentChatApps();
      yield* setChatAppsBaseline(taskId, sessionId, current, { signal });
      // Missing on the first message of a session, whose context already
      // lists the apps as they stand.
      if (stored.isErr()) {
        return ok(undefined);
      }
      const events = appEventsBetween(stored.value, current);
      if (events.length === 0) {
        return ok(undefined);
      }
      return ok({
        data: { carried: true, events },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-appEvent",
      } satisfies SessionMessagePart.Type);
    },
  );
}

/**
 * What changed between two readings of the apps, as the events a chat is
 * told: an app gone is removed, one that lost its connection is
 * disconnected, one that gained it is connected. An app set up but not yet
 * connected is the conversation's own doing and says nothing.
 */
export function appEventsBetween(
  before: ChatAppsBaseline,
  after: ChatAppsBaseline,
): SessionMessageDataPart.AppEventDataPart["events"] {
  const events: SessionMessageDataPart.AppEventDataPart["events"] = [];
  for (const [slug, was] of Object.entries(before)) {
    const now = after[slug];
    if (now === undefined) {
      events.push({ event: "removed", name: was.name, slug });
    } else if (was.connected && !now.connected) {
      events.push({
        event: "disconnected",
        name: now.name,
        slug,
        ...(now.web ? { web: now.web } : {}),
      });
    }
  }
  for (const [slug, now] of Object.entries(after)) {
    if (now.connected && before[slug]?.connected !== true) {
      events.push({
        event: "connected",
        name: now.name,
        slug,
        ...(now.web ? { web: now.web } : {}),
      });
    }
  }
  return events;
}
