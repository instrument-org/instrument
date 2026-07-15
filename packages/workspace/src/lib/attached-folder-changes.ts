import { ok, safeTry } from "neverthrow";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import {
  getAttachedFoldersBaseline,
  setAttachedFoldersBaseline,
} from "./attached-folders-baseline";
import { taskDir } from "./task-dir-utils";
import { getTaskState } from "./task-state-store";

/**
 * Diffs the task's current attached folders against the session's persisted
 * baseline to find folders removed or renamed since the baseline was last
 * set, then advances the baseline to the current set. Returns a
 * `data-attachedFolderChanges` part to attach to the user message, or
 * undefined when there is no baseline yet or nothing changed. Keyed by
 * session so an idle chat only learns about changes once it next sends a
 * message.
 *
 * Must run after any folder attach for this message (writeUploadedAttachments,
 * detectProjectChanges), so a rename either of them triggers is read here as
 * part of "current" and reported the same turn instead of lagging behind.
 */
export function detectAttachedFolderChanges({
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
      const taskState = await getTaskState(taskDir(taskId));
      const current = Object.values(taskState.attachedFolders ?? {}).map(
        (folder) => ({ name: folder.name, path: folder.path }),
      );

      const baseline = yield* getAttachedFoldersBaseline(taskId, sessionId, {
        signal,
      });

      // Re-baseline regardless of the outcome so the next message diffs against
      // the set as it stands now.
      yield* setAttachedFoldersBaseline(taskId, sessionId, current, { signal });

      if (!baseline) {
        return ok(undefined);
      }

      const currentByPath = new Map<string, string>(
        current.map((folder) => [folder.path, folder.name]),
      );
      const removed = baseline.filter(
        (folder) => !currentByPath.has(folder.path),
      );
      const renamed = baseline.flatMap((folder) => {
        const currentName = currentByPath.get(folder.path);
        if (currentName === undefined || currentName === folder.name) {
          return [];
        }
        return [
          { newName: currentName, oldName: folder.name, path: folder.path },
        ];
      });
      if (removed.length === 0 && renamed.length === 0) {
        return ok(undefined);
      }

      return ok({
        data: { removed, renamed },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-attachedFolderChanges",
      } satisfies SessionMessagePart.Type);
    },
  );
}
