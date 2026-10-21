import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessageDataPart } from "../schemas/session/message-data-part";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { type ToldDigests } from "../schemas/told";
import { ChatReads } from "./chat-reads";
import { baselineRecorded, partsAfter } from "./last-told";
import { type SetupChange } from "./setup-changes";
import { type SetupSnapshot, snapshotSetup } from "./setup-snapshot";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The kinds the agent is told about here. Memories, topics and apps have
 * notes of their own (`create-memory-part.ts`, the topic's standing part,
 * `chat-app-changes.ts`).
 */
const NEWS_KINDS = new Set(["skill"]);

/** Each skill there is now, `kind:name`, with its fingerprint. */
function toldOf(snapshot: SetupSnapshot): ToldDigests {
  return Object.fromEntries(
    [...snapshot]
      .filter(([, item]) => item.present && NEWS_KINDS.has(item.kind))
      .map(([key, item]) => [key, item.fingerprint]),
  );
}

/** The workspace's skills as a baseline written now lists them. */
export async function currentSkills(): Promise<ToldDigests> {
  return toldOf(await snapshotSetup());
}

/**
 * The skills the session last heard of: what its baseline's catalog listed,
 * then for each news note since the skills as that note left them, and what
 * the session's own turns changed laid over that. Undefined where the
 * session has no baseline that recorded them.
 */
export function lastToldSkills(
  messages: SessionMessage.WithParts[],
  sessionId: StoreId.Session,
): ToldDigests | undefined {
  const recorded = baselineRecorded(messages, sessionId, "skills");
  if (recorded === undefined) {
    return undefined;
  }
  return partsAfter(
    messages,
    ["data-setupNews", "data-setupChanges"],
    recorded.writtenAt,
  ).reduce<ToldDigests>((told, part) => {
    if (part.type === "data-setupNews") {
      return part.data.told;
    }
    const own = part.data.told?.skills;
    if (own === undefined) {
      return told;
    }
    const next = { ...told };
    for (const [key, fingerprint] of Object.entries(own)) {
      if (fingerprint === null) {
        delete next[key];
      } else {
        next[key] = fingerprint;
      }
    }
    return next;
  }, recorded.value);
}

/**
 * The skills that changed since this session last heard, on the chat's
 * user message: what another chat, the person or a program did, which the
 * session's skill catalog (written when it began) does not show. Nothing
 * before the session's first baseline, whose catalog lists them whole.
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
    const history = await ChatReads.history({ chatId, sessionId });
    const told = history.isOk()
      ? lastToldSkills(history.value, sessionId)
      : undefined;
    if (told === undefined) {
      return undefined;
    }
    const now = await currentSkills();
    const changes = changesBetween(told, now);
    if (changes.length === 0) {
      return undefined;
    }
    return {
      data: { changes, told: now },
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
 * What the session's own turn did to skills, for the turn's
 * `data-setupChanges` part to carry, so the next message's news does not
 * repeat it: each one's fingerprint now, `null` for one gone. Only those
 * items: a change someone else made meanwhile is still news.
 */
export async function skillsToldByTurn(
  changes: SetupChange[],
): Promise<Record<string, string | null> | undefined> {
  const own = changes.filter((change) => NEWS_KINDS.has(change.kind));
  if (own.length === 0) {
    return undefined;
  }
  const now = await currentSkills();
  return Object.fromEntries(
    own.map(({ kind, name }) => {
      const key = `${kind}:${name}`;
      return [key, now[key] ?? null];
    }),
  );
}

function changesBetween(
  told: ToldDigests,
  now: ToldDigests,
): SessionMessageDataPart.SetupNewsDataPart["changes"] {
  const changes: SessionMessageDataPart.SetupNewsDataPart["changes"] = [];
  for (const key of new Set([...Object.keys(told), ...Object.keys(now)])) {
    const [kind, ...rest] = key.split(":");
    const name = rest.join(":");
    if (kind !== "skill") {
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
