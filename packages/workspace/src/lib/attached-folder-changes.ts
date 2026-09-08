import { ok, safeTry } from "neverthrow";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import {
  getAttachedFoldersBaseline,
  setAttachedFoldersBaseline,
} from "./attached-folders-baseline";
import { taskDir } from "./task-dir-utils";
import { getTaskState } from "./task-record";
import { effectiveFolderAccess } from "./workspace-fs-layout";

/**
 * Diffs the task's current attached folders against the session's persisted
 * baseline to find folders removed, renamed, or re-permissioned since the
 * baseline was last set, then advances the baseline to the current set.
 * Access rides here rather than with whatever changed it, so a change reaches
 * the model whoever made it, and reaches it this turn: the standing folder
 * list lives in the session context, which is rebuilt at most hourly. Returns a
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
  announced,
  messageId,
  sessionId,
  signal,
  taskId,
}: {
  /**
   * Folders this same message already introduces in full, by host path: the
   * ones arriving with it, which the attachment part lists with their mounts
   * and their access. Announcing them again here would say the same thing
   * twice on the path folders ordinarily arrive by.
   */
  announced?: string[];
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: TaskId;
}) {
  return safeTry<SessionMessagePart.Type | undefined, Error>(
    async function* () {
      const taskState = await getTaskState(taskDir(taskId));
      const current = Object.values(taskState.attachedFolders ?? {}).map(
        (folder) => ({
          // The access the mount ended up with, not the grant on record, so a
          // folder the workspace-overlap guard downgrades is never announced as
          // writable while the filesystem refuses the writes.
          access: effectiveFolderAccess(folder),
          name: folder.mountName,
          path: folder.path,
        }),
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

      const currentByPath = new Map<string, (typeof current)[number]>(
        current.map((folder) => [folder.path, folder]),
      );
      const baselinePaths = new Set(baseline.map((folder) => folder.path));
      const introduced = new Set(announced ?? []);
      // A folder attached between turns, which on this side of the app is one
      // the conversation handed the task with `task folder --add`. The mount is
      // already live -- the sandbox is built from task state every turn -- so
      // what this carries is the telling, without which the model has a folder
      // it was never told it had and a standing list that contradicts it.
      const added = current.filter(
        (folder) =>
          !baselinePaths.has(folder.path) && !introduced.has(folder.path),
      );
      const removed = baseline.filter(
        (folder) => !currentByPath.has(folder.path),
      );
      const renamed = baseline.flatMap((folder) => {
        const currentFolder = currentByPath.get(folder.path);
        if (currentFolder === undefined || currentFolder.name === folder.name) {
          return [];
        }
        return [
          {
            newName: currentFolder.name,
            oldName: folder.name,
            path: folder.path,
          },
        ];
      });
      const accessChanged = baseline.flatMap((folder) => {
        const currentFolder = currentByPath.get(folder.path);
        if (
          currentFolder === undefined ||
          currentFolder.access === folder.access
        ) {
          return [];
        }
        return [currentFolder];
      });
      if (
        added.length === 0 &&
        removed.length === 0 &&
        renamed.length === 0 &&
        accessChanged.length === 0
      ) {
        return ok(undefined);
      }

      return ok({
        data: { accessChanged, added, removed, renamed },
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
