import { ok, safeTry } from "neverthrow";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./app-dir-utils";
import {
  getFileIndexBaseline,
  setFileIndexBaseline,
} from "./file-index-baseline";
import { diffTaskFileIndexes, getTaskFileIndex } from "./get-task-files";
import { getCurrentTaskFileIndex } from "./task-file-watcher";

/**
 * Diffs the current on-disk file index against the persisted baseline to find
 * files created, modified, or deleted between turns, then advances the baseline
 * to the current tree. Returns a `data-externalFileChanges` part to attach to
 * the user message, or undefined when there is no baseline yet or nothing
 * changed. Uses the live watcher index when one is active, otherwise walks disk.
 */
export function detectExternalFileChanges({
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
      const current =
        getCurrentTaskFileIndex(taskId) ??
        (yield* await getTaskFileIndex(taskDir(taskId), { signal }));

      const baseline = yield* getFileIndexBaseline(taskId, sessionId, {
        signal,
      });

      // Re-baseline regardless of the outcome so the next message diffs against
      // the tree as it stands now.
      yield* setFileIndexBaseline(taskId, sessionId, current, { signal });

      if (!baseline) {
        return ok(undefined);
      }

      const changes = diffTaskFileIndexes({
        after: current,
        before: baseline,
      });
      if (changes.length === 0) {
        return ok(undefined);
      }

      return ok({
        data: { files: changes },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-externalFileChanges",
      } satisfies SessionMessagePart.Type);
    },
  );
}
