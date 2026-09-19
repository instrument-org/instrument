import { isEqual } from "radashi";
import { z } from "zod";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import {
  listMemories,
  type Memory,
  memoryDigests,
  memoryDir,
  memoryHeadline,
} from "./memory/store";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";
import { getWorkspaceConfig } from "./workspace-config";

/** How many memories a whole note lists before the rest are counted. */
const MEMORIES_IN_NOTE = 64;
/** How much of a memory's first line the note carries; the whole is a `memory show` away. */
const HEADLINE_MAX = 240;

/** Each memory the session has been told of, by name, with a digest of what it held. */
const ToldSchema = z.record(z.string(), z.string());

/**
 * What memory holds, for the turn about to run, on a thread's user message.
 *
 * Attached only when memory changed since this session was last told, the
 * way the pane report is: on the thread's first message, and again after
 * another thread, the user, or a file edit changed it. The first note is the
 * whole of memory; every later one carries only what was saved, corrected,
 * or forgotten since, because each note stays in the thread for good and a
 * thread that outlives many changes would otherwise carry the whole of
 * memory once per change. A change the thread made itself is recorded as
 * told by the command that made it, so the note never restates what the
 * agent just did.
 */
export async function createMemoryPart({
  createdAt,
  messageId,
  sessionId,
  taskId,
}: {
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<SessionMessagePart.Type | undefined> {
  try {
    const memories = await listMemories(memoryDir());
    const digests = memoryDigests(memories);

    const storage = await getSessionsStoreStorage(taskId);
    if (storage.isErr()) {
      return undefined;
    }
    const reported = await getParsedStorageItem(
      StorageKey.memoryReported(sessionId),
      ToldSchema,
      storage.value,
    );
    // Nothing recorded reads as told nothing, which is what an empty memory
    // also reads as: a fresh thread with nothing to remember gets no note.
    const told = reported.isOk() ? reported.value : {};
    if (isEqual(told, digests)) {
      return undefined;
    }

    await setParsedStorageItem(
      StorageKey.memoryReported(sessionId),
      digests,
      ToldSchema,
      storage.value,
    );

    const metadata = {
      createdAt,
      id: StoreId.newPartId(),
      messageId,
      sessionId,
    };
    const sentAt = createdAt.getTime();
    // A thread told nothing yet hears the whole; so does one whose memory is
    // gone, since "empty now" says more than a list of every name forgotten.
    if (Object.keys(told).length === 0 || memories.length === 0) {
      return {
        data: {
          forgotten: [],
          memories: memories.slice(0, MEMORIES_IN_NOTE).map(noteRow),
          more: Math.max(0, memories.length - MEMORIES_IN_NOTE),
          sentAt,
          tells: "whole",
        },
        metadata,
        type: "data-memory",
      };
    }
    return {
      data: {
        forgotten: Object.keys(told).filter((name) => !(name in digests)),
        memories: memories
          .filter((memory) => told[memory.name] !== digests[memory.name])
          .map(noteRow),
        more: 0,
        sentAt,
        tells: "changes",
      },
      metadata,
      type: "data-memory",
    };
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}

/** Marks what memory holds as told to this session. */
export async function recordMemoryReported({
  memories,
  sessionId,
  taskId,
}: {
  memories: Memory[];
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<void> {
  const storage = await getSessionsStoreStorage(taskId);
  if (storage.isErr()) {
    return;
  }
  await setParsedStorageItem(
    StorageKey.memoryReported(sessionId),
    memoryDigests(memories),
    ToldSchema,
    storage.value,
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
