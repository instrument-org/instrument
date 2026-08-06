import { ok, safeTry } from "neverthrow";
import { ulid } from "ulid";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { assignMountNames } from "./assign-mount-names";
import { getEffectiveProjectContext } from "./effective-project-context";
import { getCurrentDate } from "./get-current-date";
import { getProject } from "./project";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";
import { getTaskState, setTaskState } from "./task-state-store";
import { effectiveFolderAccess } from "./workspace-fs-layout";

/**
 * Compares the live project against the task's frozen project snapshot (folded
 * with any earlier changes) when a user message is sent, and reports drift in
 * instructions or attached folders. No watcher: a single read at send time.
 *
 * Folder additions, removals, and access changes are applied to the task's
 * attached folders here so they become standing context; the returned
 * `data-projectChanges` part announces the additions and removals. An access
 * change is announced by detectAttachedFolderChanges instead, which diffs task
 * state and so reports one however it was made. Because instructions
 * are read from the latest change part and folders from task state, an
 * already-reported change won't re-announce on the next message. Names for the whole surviving+new folder set are
 * recomputed on every run, even with nothing added/removed -- cheap and
 * idempotent, so it also corrects any folder named under an earlier version of
 * assignMountNames without a separate migration. Returns undefined for
 * non-project tasks, the first message (snapshot not yet persisted), a deleted
 * project, or no change.
 */
export function detectProjectChanges({
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
      const messages = yield* Store.getMessagesWithParts(
        { sessionId, taskId },
        { signal },
      );

      const effective = getEffectiveProjectContext(
        messages.flatMap((message) => message.parts),
      );
      // No snapshot: not a project task, or the first message hasn't persisted
      // its snapshot yet. Either way there is no baseline to diff against.
      if (!effective) {
        return ok(undefined);
      }

      const projectResult = await getProject(effective.projectId);
      // Project deleted/unreadable: the snapshot keeps the task working;
      // orphaned references are swept elsewhere. Nothing to report here.
      if (projectResult.isErr()) {
        return ok(undefined);
      }
      const project = projectResult.value;

      const liveInstructions = project.instructions.trim() || undefined;
      const effectiveInstructions = effective.instructions?.trim() || undefined;
      const instructionsChanged = liveInstructions !== effectiveInstructions;

      const dir = taskDir(taskId);
      const taskState = await getTaskState(dir);
      const attachedFolders = taskState.attachedFolders ?? {};

      const liveFolderAccess = new Map(
        project.folders.map((folder) => [folder.path, folder.access]),
      );
      const attachedPaths = new Set<string>(
        Object.values(attachedFolders).map((folder) => folder.path),
      );

      const foldersRemoved: { name: string; path: string }[] = [];
      const survivingFolders: FolderAttachment.Type[] = [];
      let accessChanged = false;
      for (const folder of Object.values(attachedFolders)) {
        if (folder.source !== "project") {
          survivingFolders.push(folder);
          continue;
        }
        const liveAccess = liveFolderAccess.get(folder.path);
        if (liveAccess === undefined) {
          foldersRemoved.push({ name: folder.mountName, path: folder.path });
          continue;
        }
        // The project owns the access level of the folders it contributes, so
        // a change there reaches every task that carries them.
        if (liveAccess !== folder.access) {
          accessChanged = true;
        }
        survivingFolders.push({ ...folder, access: liveAccess });
      }

      const newFolders: FolderAttachment.Type[] = [];
      for (const { access, path: folderPath } of project.folders) {
        if (attachedPaths.has(folderPath)) {
          continue;
        }
        const parsedPath = AbsolutePathSchema.safeParse(folderPath);
        if (!parsedPath.success) {
          continue;
        }
        newFolders.push({
          access,
          createdAt: getCurrentDate().getTime(),
          id: FolderAttachment.IdSchema.parse(ulid()),
          mountName: "",
          path: parsedPath.data,
          source: "project",
        });
      }

      // Any correction here reaches the agent via detectAttachedFolderChanges,
      // which reads task state after this runs (see new-message.ts ordering).
      const allFolders = [...survivingFolders, ...newFolders].sort(
        (a, b) => a.createdAt - b.createdAt,
      );
      const names = assignMountNames(allFolders);

      const nextFolders: Record<string, FolderAttachment.Type> = {};
      let stateChanged = foldersRemoved.length > 0 || accessChanged;
      for (const folder of allFolders) {
        const mountName = names.get(folder.id) ?? folder.mountName;
        if (mountName !== folder.mountName) {
          stateChanged = true;
        }
        nextFolders[mountName] = { ...folder, mountName };
      }

      if (!instructionsChanged && !stateChanged) {
        return ok(undefined);
      }

      if (stateChanged) {
        await setTaskState(dir, { attachedFolders: nextFolders });
      }

      const foldersAdded = newFolders.map((folder) => ({
        // As with the folder list itself: what the mount ended up allowing,
        // which the workspace-overlap guard can narrow.
        access: effectiveFolderAccess(folder),
        name: names.get(folder.id) ?? folder.path,
        path: folder.path,
      }));

      return ok({
        data: {
          foldersAdded,
          foldersRemoved,
          instructions: instructionsChanged ? liveInstructions : undefined,
          instructionsChanged,
          projectId: project.id,
          projectName: project.name,
        },
        metadata: {
          createdAt: new Date(),
          id: StoreId.newPartId(),
          messageId,
          sessionId,
        },
        type: "data-projectChanges",
      } satisfies SessionMessagePart.Type);
    },
  );
}
