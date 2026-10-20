import { z } from "zod";

import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { ChatReads } from "./chat-reads";
import { ChatWrites } from "./chat-writes";
import { type SetupChange } from "./setup-changes";
import { type SetupSnapshot, snapshotSetup } from "./setup-snapshot";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The kinds the agent is told about here. Memories and topics have notes of
 * their own (`create-memory-part.ts`, the topic's standing part).
 */
const NEWS_KINDS = new Set(["app", "skill"]);

/** Each skill and app the session has heard of, `kind:name`, with its fingerprint. */
const ToldSchema = z.record(z.string(), z.string());

type Told = z.output<typeof ToldSchema>;

function toldOf(snapshot: SetupSnapshot): Told {
  return Object.fromEntries(
    [...snapshot]
      .filter(([, item]) => item.present && NEWS_KINDS.has(item.kind))
      .map(([key, item]) => [key, item.fingerprint]),
  );
}

/**
 * The skills and apps that changed since this session last heard, on the
 * chat's user message: what another chat, the person or a program did,
 * which the session's skill catalog and app list (written when it began)
 * do not show. A session's first message only records what there is, since
 * its context lists it whole.
 */
export async function createSetupNewsPart({
  createdAt,
  messageId,
  sessionId,
  chatId,
}: {
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  chatId: ChatId;
}): Promise<SessionMessagePart.Type | undefined> {
  try {
    const now = toldOf(await snapshotSetup());
    const reported = await ChatReads.state({
      chatId,
      schema: ToldSchema,
      sessionId,
      what: "setup",
    });
    const told = reported.isOk() ? reported.value : undefined;
    await ChatWrites.state(chatId, sessionId, "setup", now);
    if (told === undefined) {
      return undefined;
    }
    const changes = changesBetween(told, now);
    if (changes.length === 0) {
      return undefined;
    }
    return {
      data: { changes },
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-setupNews",
    };
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}

/**
 * Marks what the session's own turn changed as heard, after it told the
 * agent through `setupChanges`, so the next message does not repeat it. Only
 * those items: a change someone else made meanwhile is still news.
 */
export async function recordSetupTold({
  changes,
  chatId,
  sessionId,
}: {
  changes: SetupChange[];
  chatId: ChatId;
  sessionId: StoreId.Session;
}): Promise<void> {
  const own = changes.filter((change) => NEWS_KINDS.has(change.kind));
  if (own.length === 0) {
    return;
  }
  const reported = await ChatReads.state({
    chatId,
    schema: ToldSchema,
    sessionId,
    what: "setup",
  });
  if (!reported.isOk() || reported.value === undefined) {
    return;
  }
  const now = toldOf(await snapshotSetup());
  const told = { ...reported.value };
  for (const { kind, name } of own) {
    const key = `${kind}:${name}`;
    if (key in now) {
      told[key] = now[key] ?? "";
    } else {
      delete told[key];
    }
  }
  await ChatWrites.state(chatId, sessionId, "setup", told);
}

function changesBetween(
  told: Told,
  now: Told,
): SessionMessageDataPart.SetupNewsDataPart["changes"] {
  const changes: SessionMessageDataPart.SetupNewsDataPart["changes"] = [];
  for (const key of new Set([...Object.keys(told), ...Object.keys(now)])) {
    const [kind, ...rest] = key.split(":");
    const name = rest.join(":");
    if (kind !== "app" && kind !== "skill") {
      continue;
    }
    // What is gone is left out (`SetupNewsDataPartSchema`).
    const change = !(key in now)
      ? undefined
      : !(key in told)
        ? "added"
        : told[key] === now[key]
          ? undefined
          : "changed";
    if (change) {
      changes.push({ change, kind, name });
    }
  }
  return changes.toSorted(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
}
