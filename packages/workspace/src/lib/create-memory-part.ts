import { z } from "zod";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import {
  listMemories,
  memoryDir,
  memoryHeadline,
  memoryRevision,
} from "./memory/store";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";
import { getWorkspaceConfig } from "./workspace-config";

/** How many memories a note lists before the rest are counted. */
const MEMORIES_IN_NOTE = 64;
/** How much of a memory's first line the note carries; the whole is a `memory show` away. */
const HEADLINE_MAX = 240;

const RevisionSchema = z.string();

/**
 * What memory holds, for the turn about to run, on a thread's user message:
 * every memory's first line, where it came from, and when.
 *
 * Attached only when memory changed since this session was last told, the
 * way the pane report is: on the thread's first message, and again after
 * another thread, the user, or a file edit changed it. A change the thread
 * made itself is recorded as told by the command that made it, so the note
 * never restates what the agent just did.
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
    const revision = memoryRevision(memories);

    const storage = await getSessionsStoreStorage(taskId);
    if (storage.isErr()) {
      return undefined;
    }
    const reported = await getParsedStorageItem(
      StorageKey.memoryReported(sessionId),
      RevisionSchema,
      storage.value,
    );
    // Nothing recorded reads as told nothing, which is what an empty memory
    // also reads as: a fresh thread with nothing to remember gets no note.
    const previous = reported.isOk() ? reported.value : "";
    if (previous === revision) {
      return undefined;
    }

    await setParsedStorageItem(
      StorageKey.memoryReported(sessionId),
      revision,
      RevisionSchema,
      storage.value,
    );

    return {
      data: {
        memories: memories.slice(0, MEMORIES_IN_NOTE).map((memory) => ({
          at: memory.at,
          ...(memory.from ? { from: memory.from.title } : {}),
          name: memory.name,
          text: memoryHeadline(memory.text).slice(0, HEADLINE_MAX),
        })),
        more: Math.max(0, memories.length - MEMORIES_IN_NOTE),
        sentAt: createdAt.getTime(),
      },
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-memory",
    };
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}

/** Marks a revision of memory as one this session has seen. */
export async function recordMemoryReported({
  revision,
  sessionId,
  taskId,
}: {
  revision: string;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<void> {
  const storage = await getSessionsStoreStorage(taskId);
  if (storage.isErr()) {
    return;
  }
  await setParsedStorageItem(
    StorageKey.memoryReported(sessionId),
    revision,
    RevisionSchema,
    storage.value,
  );
}
