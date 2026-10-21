import { ok, safeTry } from "neverthrow";
import { z } from "zod";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { isConnected } from "./apps/connection";
import { listApps } from "./apps/store";
import { folderFingerprint } from "./folder-fingerprint";
import { ChatReads } from "./chat-reads";
import { ChatWrites } from "./chat-writes";
import { getWorkspaceConfig } from "./workspace-config";

const ChatAppsBaselineSchema = z.record(
  z.string(),
  z.object({
    connected: z.boolean(),
    /** What its folder held (`folder-fingerprint.ts`); missing in a baseline from an earlier build. */
    fingerprint: z.string().optional(),
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
    await Promise.all(
      apps.map(async (app): Promise<[string, ChatAppsBaseline[string]]> => [
        app.slug,
        {
          connected: isConnected(connections[app.slug], app.manifestHash),
          fingerprint: await folderFingerprint(app.dir),
          name: app.name,
          ...(app.manifest.type === "web" ? { web: app.manifest.url } : {}),
        },
      ]),
    ),
  );
}

/** Records the apps as the chat's agent now knows them, so the next message diffs from here. */
export function setChatAppsBaseline(
  chatId: ChatId,
  sessionId: StoreId.Session,
  apps: ChatAppsBaseline,
) {
  return ChatWrites.state(chatId, sessionId, "apps", apps);
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
  chatId,
}: {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  chatId: ChatId;
}) {
  return safeTry<SessionMessagePart.Type | undefined, Error>(
    async function* () {
      const stored = await ChatReads.state({
        chatId,
        schema: ChatAppsBaselineSchema,
        sessionId,
        what: "apps",
      });
      const current = await currentChatApps();
      yield* setChatAppsBaseline(chatId, sessionId, current);
      // Missing on the first message of a session, whose context already
      // lists the apps as they stand.
      if (stored.isErr() || stored.value === undefined) {
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
 * disconnected, one that gained it is connected, a new one not connected yet
 * is added, and one whose folder holds something else is changed. What the
 * conversation's own turn did is in the baseline already (`recordAppsTold`).
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
    } else if (
      was.fingerprint !== undefined &&
      now.fingerprint !== undefined &&
      was.fingerprint !== now.fingerprint &&
      was.connected === now.connected
    ) {
      events.push({ event: "changed", name: now.name, slug });
    }
  }
  for (const [slug, now] of Object.entries(after)) {
    if (!now.connected && before[slug] === undefined) {
      events.push({ event: "added", name: now.name, slug });
    } else if (now.connected && before[slug]?.connected !== true) {
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

/**
 * Takes what the conversation's own turn did to apps (by their folders'
 * names) into the baseline, so the next message does not tell the agent
 * what it did itself. Only those apps: a change made elsewhere meanwhile is
 * still news. Nothing where the session has no baseline yet.
 */
export async function recordAppsTold({
  chatId,
  names,
  sessionId,
}: {
  chatId: ChatId;
  names: readonly string[];
  sessionId: StoreId.Session;
}): Promise<void> {
  if (names.length === 0) {
    return;
  }
  const stored = await ChatReads.state({
    chatId,
    schema: ChatAppsBaselineSchema,
    sessionId,
    what: "apps",
  });
  if (stored.isErr() || stored.value === undefined) {
    return;
  }
  const current = await currentChatApps();
  const own = new Set(names);
  const told = Object.fromEntries(
    Object.entries(stored.value).filter(([, app]) => !own.has(app.name)),
  );
  for (const [slug, app] of Object.entries(current)) {
    if (own.has(app.name)) {
      told[slug] = app;
    }
  }
  await setChatAppsBaseline(chatId, sessionId, told);
}
