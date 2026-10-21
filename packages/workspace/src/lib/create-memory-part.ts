import { isEqual } from "radashi";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { type ToldDigests } from "../schemas/told";
import { ChatReads } from "./chat-reads";
import { partsAfter, rolledOverAfter } from "./last-told";
import {
  listMemories,
  type Memory,
  memoryDigests,
  memoryDir,
  memoryHeadline,
} from "./memory/store";
import { type SetupChange } from "./setup-changes";
import { getWorkspaceConfig } from "./workspace-config";

/** How many memories a whole note lists before the rest are counted. */
const MEMORIES_IN_NOTE = 64;
/** How much of a memory's first line the note carries; the whole is an `instrument memory show` away. */
const HEADLINE_MAX = 240;

/**
 * Each memory the session's model was last told of, by name, with a digest of
 * what it held, from the notes in the window it is sent: a whole note says
 * all of memory, a note of changes the memories it names, and the session's
 * own turns what they changed. The window starts at the newest rollover, so
 * what a note the cut dropped told is told again.
 */
export function lastToldMemory(
  messages: SessionMessage.WithParts[],
  sessionId: StoreId.Session,
): ToldDigests {
  return partsAfter(
    messages,
    ["data-memory", "data-setupChanges"],
    rolledOverAfter(messages, sessionId),
  ).reduce<ToldDigests>((known, part) => {
    if (part.type === "data-memory" && part.data.tells === "whole") {
      return part.data.told;
    }
    const changed =
      part.type === "data-memory"
        ? {
            ...Object.fromEntries(
              part.data.forgotten.map((name) => [name, null]),
            ),
            ...Object.fromEntries(
              part.data.memories.map(({ name }) => [
                name,
                part.data.told[name] ?? null,
              ]),
            ),
          }
        : (part.data.told?.memory ?? {});
    const next = { ...known };
    for (const [name, digest] of Object.entries(changed)) {
      if (digest === null) {
        delete next[name];
      } else {
        next[name] = digest;
      }
    }
    return next;
  }, {});
}

/**
 * What memory holds, for the turn about to run, on a chat's user message.
 *
 * Attached only when memory changed since this session was last told, the
 * way the browser status is: on the chat's first message, and again after
 * another chat, the user, or a file edit changed it. The first note is the
 * whole of memory; every later one carries only what was saved, corrected,
 * or forgotten since, because each note stays in the chat for good and a
 * chat that outlives many changes would otherwise carry the whole of
 * memory once per change. A change the chat made itself is told by its
 * turn's `data-setupChanges` part (`memoryToldByTurn`), so the note never
 * restates what the agent just did.
 */
export async function createMemoryPart({
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
    const memories = await listMemories(memoryDir());
    const digests = memoryDigests(memories);

    const history = await ChatReads.history({ chatId, sessionId });
    // Told nothing is what an empty memory also reads as: a fresh chat with
    // nothing to remember gets no note.
    const state = history.isOk() ? lastToldMemory(history.value, sessionId) : {};
    if (isEqual(state, digests)) {
      return undefined;
    }

    const metadata = {
      createdAt,
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    };
    const sentAt = createdAt.getTime();
    // A chat told nothing yet hears the whole; so does one whose memory is
    // gone, since "empty now" says more than a list of every name forgotten.
    if (Object.keys(state).length === 0 || memories.length === 0) {
      return {
        data: {
          forgotten: [],
          memories: memories.slice(0, MEMORIES_IN_NOTE).map(noteRow),
          more: Math.max(0, memories.length - MEMORIES_IN_NOTE),
          sentAt,
          tells: "whole",
          told: digests,
        },
        metadata,
        type: "data-memory",
      };
    }
    return {
      data: {
        forgotten: Object.keys(state).filter((name) => !(name in digests)),
        memories: memories
          .filter((memory) => state[memory.name] !== digests[memory.name])
          .map(noteRow),
        more: 0,
        sentAt,
        tells: "changes",
        told: digests,
      },
      metadata,
      type: "data-memory",
    };
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}

/**
 * What the session's own turn did to memory, for the turn's
 * `data-setupChanges` part to carry, so the next note does not tell the agent
 * what it did itself: each memory's digest now, `null` for one forgotten.
 * Only those names: a change another chat or the person made meanwhile is
 * still news.
 */
export async function memoryToldByTurn(
  changes: SetupChange[],
): Promise<Record<string, string | null> | undefined> {
  const own = changes.filter((change) => change.kind === "memory");
  if (own.length === 0) {
    return undefined;
  }
  const digests = memoryDigests(await listMemories(memoryDir()));
  return Object.fromEntries(
    own.map(({ name }) => [name, digests[name] ?? null]),
  );
}

function noteRow(memory: Memory) {
  return {
    at: memory.at,
    ...(memory.from ? { from: memory.from.title } : {}),
    name: memory.name,
    text: memoryHeadline(memory.text).slice(0, HEADLINE_MAX),
  };
}
