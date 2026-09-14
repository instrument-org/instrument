import { ResultAsync } from "neverthrow";
import { z } from "zod";

import { SessionMessageRelaxedPart } from "../schemas/session/message-relaxed-part";
import { type StoreId } from "../schemas/store-id";
import { getCurrentDate } from "./get-current-date";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";
import { type WrappedStorage } from "./wrap-storage";

// Only the role is read: which side wrote the message is all the walk below
// needs to know, and the full message schema is not this module's to depend on.
const MessageRoleSchema = z.object({ role: z.string() });

export const INTERRUPTED_TOOL_CALL_ERROR_TEXT =
  "This action was interrupted when the app closed.";

/**
 * Finalizes tool calls that a process left mid-flight.
 *
 * A tool part in `input-available` or `input-streaming` is one whose writer has
 * not finished with it. While the app runs, the agent machine owns every such
 * part and settles it itself: the call completes, the user stops it, or the
 * turn's finishing sweep writes `output-error` on what a stop or an error
 * stranded. A process that dies mid-call does none of that, and nothing later
 * does either: the next run's sweep covers only its own messages, so the part
 * stays unresolved in the transcript forever, and is dropped from the model's
 * view of the session, which filters `input-*` parts out.
 *
 * Runs where a task's database is opened, before anything reads through it.
 * That is what makes the sweep safe: this process has no run of the task yet,
 * so every `input-*` part it finds belongs to a process that is gone. Sweeping
 * once the storage is shared would race the run this open is about to start.
 *
 * Only the newest assistant message of each session is read. Calls run one at
 * a time and a step's calls all settle before the next step writes a message,
 * so the parts a dead run left are in the last assistant message it wrote;
 * what follows it can only be user messages it never answered. Cheap on the
 * open path as a result: a key listing, then a message or two per session.
 *
 * Reads through the schemas the store itself uses. What it writes mirrors the
 * record `saveStoppedToolCallPart` writes for a stopped call, which cannot be
 * called from here: it reads through `Store`, which opens the database this
 * sweep is part of opening.
 */
export function sweepInterruptedToolCalls({
  signal,
  storage,
}: {
  signal?: AbortSignal;
  storage: WrappedStorage;
}): ResultAsync<{ swept: number }, Error> {
  return ResultAsync.fromPromise(
    sweep({ signal, storage }),
    (error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
  );
}

async function finalizeInterruptedParts({
  messageId,
  sessionId,
  signal,
  storage,
}: {
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  storage: WrappedStorage;
}): Promise<number> {
  const partKeys = await storage.getKeys(
    StorageKey.parts(sessionId, messageId),
    { signal },
  );
  if (partKeys.isErr()) {
    throw partKeys.error;
  }

  let finalized = 0;
  for (const key of partKeys.value) {
    const part = await getParsedStorageItem(
      key,
      SessionMessageRelaxedPart.Schema,
      storage,
      { signal },
    );
    if (part.isErr() || !isInterruptedToolPart(part.value)) {
      continue;
    }

    const written = await setParsedStorageItem(
      key,
      {
        ...part.value,
        errorText: INTERRUPTED_TOOL_CALL_ERROR_TEXT,
        metadata: { ...part.value.metadata, endedAt: getCurrentDate() },
        state: "output-error",
      },
      SessionMessageRelaxedPart.Schema,
      storage,
      { signal },
    );
    if (written.isErr()) {
      throw written.error;
    }
    finalized += 1;
  }
  return finalized;
}

function isInterruptedToolPart(
  part: SessionMessageRelaxedPart.Type,
): part is SessionMessageRelaxedPart.ToolPart {
  return (
    part.type.startsWith("tool-") &&
    "state" in part &&
    (part.state === "input-available" || part.state === "input-streaming")
  );
}

async function sweep({
  signal,
  storage,
}: {
  signal?: AbortSignal;
  storage: WrappedStorage;
}): Promise<{ swept: number }> {
  const messageKeys = await storage.getKeys(StorageKey.MESSAGES_KEY, {
    signal,
  });
  if (messageKeys.isErr()) {
    throw messageKeys.error;
  }

  const messageIdsBySession = new Map<StoreId.Session, StoreId.Message[]>();
  for (const key of messageKeys.value) {
    const sessionId = StorageKey.extractMessageSessionId(key);
    const messageIds = messageIdsBySession.get(sessionId) ?? [];
    messageIds.push(StorageKey.extractMessageId(key));
    messageIdsBySession.set(sessionId, messageIds);
  }

  let swept = 0;
  for (const [sessionId, messageIds] of messageIdsBySession) {
    // Ids are ULIDs, so id order is creation order; newest first.
    const newestFirst = [...messageIds].sort((a, b) => (a < b ? 1 : -1));
    for (const messageId of newestFirst) {
      const message = await getParsedStorageItem(
        StorageKey.message(sessionId, messageId),
        MessageRoleSchema,
        storage,
        { signal },
      );
      // A row that cannot be read is one nothing can settle; keep walking, as
      // the assistant message the walk is after may be behind it.
      if (message.isErr() || message.value.role !== "assistant") {
        continue;
      }
      swept += await finalizeInterruptedParts({
        messageId,
        sessionId,
        signal,
        storage,
      });
      break;
    }
  }

  return { swept };
}
