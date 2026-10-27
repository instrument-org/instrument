import { ok, safeTry } from "neverthrow";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { type ToldApps } from "../schemas/told";
import { isConnected } from "./apps/connection";
import { listApps } from "./apps/store";
import { folderFingerprint } from "./folder-fingerprint";
import { ChatReads } from "./chat-reads";
import { baselineRecorded, partsAfter } from "./last-told";
import { getWorkspaceConfig } from "./workspace-config";

/** The workspace's apps as a chat's agent is told about them: each one's name and whether it is connected on this computer. */
export async function currentChatApps(): Promise<ToldApps> {
  const { apps: config, appsDir, deviceId } = getWorkspaceConfig();
  const { apps } = await listApps(appsDir);
  const connections = await config.connections.list();
  return Object.fromEntries(
    await Promise.all(
      apps.map(
        async (app): Promise<[string, ToldApps[string]]> => [
          app.slug,
          {
            connected: isConnected(connections[app.slug], app.manifestHash),
            device: deviceId,
            fingerprint: await folderFingerprint(app.dir),
            name: app.name,
            ...(app.manifest.type === "web" ? { web: app.manifest.url } : {}),
          },
        ],
      ),
    ),
  );
}

/**
 * The apps the chat's agent was last told of: what its baseline listed, then
 * for each app note since the apps as that note left them, and what the
 * session's own turns did to apps laid over that. Undefined where the
 * session has no baseline that recorded them.
 */
export function lastToldApps(
  messages: SessionMessage.WithParts[],
  sessionId: StoreId.Session,
): ToldApps | undefined {
  const recorded = baselineRecorded(messages, sessionId, "apps");
  if (recorded === undefined) {
    return undefined;
  }
  return partsAfter(
    messages,
    ["data-appEvent", "data-setupChanges"],
    recorded.writtenAt,
  ).reduce<ToldApps>((told, part) => {
    if (part.type === "data-appEvent") {
      return part.data.apps;
    }
    const own = part.data.told?.apps;
    if (own === undefined) {
      return told;
    }
    const next = { ...told };
    for (const [slug, app] of Object.entries(own)) {
      if (app === null) {
        delete next[slug];
      } else {
        next[slug] = app;
      }
    }
    return next;
  }, recorded.value);
}

/**
 * Diffs the workspace's apps against what the chat's agent last heard
 * (`lastToldApps`). Returns a `data-appEvent` part, marked as carried on the
 * user's message, for the apps connected, disconnected, or removed since,
 * holding the apps as they now stand; undefined where there is no baseline
 * yet or nothing changed.
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
      const told = lastToldApps(
        yield* ChatReads.history({ chatId, sessionId }),
        sessionId,
      );
      // Missing before the session's first baseline, which lists the apps as
      // they stand.
      if (told === undefined) {
        return ok(undefined);
      }
      const current = await currentChatApps();
      const events = appEventsBetween(told, current);
      const otherComputer = toldOnOtherComputer(told, current);
      if (events.length === 0 && !otherComputer) {
        return ok(undefined);
      }
      return ok({
        data: {
          apps: current,
          carried: true,
          events,
          ...(otherComputer && { otherComputer }),
        },
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
 * The note that wakes a chat with the user's answer to an app it asked for:
 * the answer, then every other change since the chat's session was last told
 * of its apps, so the apps the note saves as told are the apps it told.
 */
export function appWakeNote({
  chatId,
  events,
  notOnCard,
  sessionId,
  signIns,
}: {
  chatId: ChatId;
  events: SessionMessageDataPart.AppEventDataPart["events"];
  sessionId: StoreId.Session;
  signIns?: SessionMessageDataPart.SignInProgress;
  notOnCard?: SessionMessageDataPart.NotOnCard;
}) {
  return safeTry<SessionMessageDataPart.AppEventDataPart, Error>(
    async function* () {
      const told = lastToldApps(
        yield* ChatReads.history({ chatId, sessionId }),
        sessionId,
      );
      const current = await currentChatApps();
      const answered = new Set(events.map((event) => event.slug));
      const since =
        told === undefined
          ? []
          : appEventsBetween(told, current).filter(
              (event) => !answered.has(event.slug),
            );
      const otherComputer =
        told !== undefined && toldOnOtherComputer(told, current);
      return ok({
        apps: current,
        events: [...events, ...since],
        ...(otherComputer && { otherComputer }),
        ...(signIns === undefined ? {} : { signIns }),
        ...(notOnCard === undefined ? {} : { notOnCard }),
      });
    },
  );
}

/**
 * Whether an app the session was told of had its connection read on another
 * computer than the one `current` was read on, which says nothing of this
 * computer's: the note then tells this computer's whole (`otherComputer`).
 */
function toldOnOtherComputer(told: ToldApps, current: ToldApps): boolean {
  return Object.entries(current).some(
    ([slug, now]) =>
      told[slug] !== undefined && told[slug].device !== now.device,
  );
}

/**
 * What changed between two readings of the apps, as the events a chat is
 * told: an app gone is removed, one that lost its connection is
 * disconnected, one that gained it is connected, a new one not connected yet
 * is added, and one whose folder holds something else is changed. What the
 * conversation's own turn did is told already (`appsToldByTurn`).
 *
 * A connection is compared only between two readings on one computer: one
 * computer's against another's is no change at all (`toldOnOtherComputer`).
 */
export function appEventsBetween(
  before: ToldApps,
  after: ToldApps,
): SessionMessageDataPart.AppEventDataPart["events"] {
  const events: SessionMessageDataPart.AppEventDataPart["events"] = [];
  for (const [slug, was] of Object.entries(before)) {
    const now = after[slug];
    const sameComputer = now?.device === was.device;
    if (now === undefined) {
      events.push({ event: "removed", name: was.name, slug });
    } else if (sameComputer && was.connected && !now.connected) {
      events.push({
        event: "disconnected",
        name: now.name,
        slug,
        ...(now.web ? { web: now.web } : {}),
      });
    } else if (
      was.fingerprint !== now.fingerprint &&
      (!sameComputer || was.connected === now.connected)
    ) {
      events.push({ event: "changed", name: now.name, slug });
    }
  }
  for (const [slug, now] of Object.entries(after)) {
    const was = before[slug];
    if (!now.connected && was === undefined) {
      events.push({ event: "added", name: now.name, slug });
    } else if (
      now.connected &&
      (was === undefined || (was.device === now.device && !was.connected))
    ) {
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
 * What the conversation's own turn did to apps (by their folders' names), as
 * the agent now knows them, for the turn's `data-setupChanges` part to carry
 * so the next message does not tell the agent what it did itself: each such
 * app as it stands, and `null` for one told before that is gone. Only those
 * apps: a change made elsewhere meanwhile is still news.
 */
export async function appsToldByTurn({
  names,
  told,
}: {
  names: readonly string[];
  /** What the session was told before the turn (`lastToldApps`). */
  told: ToldApps | undefined;
}): Promise<Record<string, ToldApps[string] | null> | undefined> {
  if (names.length === 0 || told === undefined) {
    return undefined;
  }
  const current = await currentChatApps();
  const own = new Set(names);
  const changed: Record<string, ToldApps[string] | null> = {};
  for (const [slug, app] of Object.entries(told)) {
    if (own.has(app.name)) {
      changed[slug] = null;
    }
  }
  for (const [slug, app] of Object.entries(current)) {
    if (own.has(app.name)) {
      changed[slug] = app;
    }
  }
  return changed;
}
