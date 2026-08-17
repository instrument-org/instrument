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
import { normalizeProjectInstructions } from "./project-instructions";
import { reconcileProjectFolders } from "./reconcile-project-folders";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";
import { getTaskState, setTaskState } from "./task-record";
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
 * state and so reports one however it was made. Which of the two sides an
 * inherited folder follows is settled by reconcileProjectFolders, not here: a
 * task may edit what it inherited, and the later edit is the one that holds.
 * Because instructions
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

      // Both sides capped, so the comparison is between the two versions of what
      // the agent actually receives. An edit only the truncated tail saw leaves
      // the standing context identical and has nothing to announce; the agent
      // reads the current file from the project mount either way.
      const liveInstructions = normalizeProjectInstructions(
        project.instructions,
      );
      const effectiveInstructions = normalizeProjectInstructions(
        effective.instructions ?? "",
      );
      const instructionsChanged = liveInstructions !== effectiveInstructions;

      const dir = taskDir(taskId);
      const taskState = await getTaskState(dir);
      const attachedFolders = taskState.attachedFolders ?? {};

      const baseline = taskState.projectFolderBaseline ?? {};
      const settled = reconcileProjectFolders({
        attached: Object.values(attachedFolders),
        baseline,
        projectFolders: project.folders,
      });

      const foldersRemoved = settled.removed.map((folder) => ({
        name: folder.mountName,
        path: folder.path,
      }));
      const survivingFolders = settled.surviving;
      const accessBefore = new Map(
        Object.values(attachedFolders).map((folder) => [
          folder.id,
          folder.access,
        ]),
      );
      const accessChanged = survivingFolders.some(
        (folder) => accessBefore.get(folder.id) !== folder.access,
      );

      const newFolders: FolderAttachment.Type[] = [];
      for (const { access, path: folderPath } of settled.toAttach) {
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

      // Everything the project offers now, whether or not this task carries it,
      // so a folder the task declined stays declined and one the project moves
      // is read as moved next time. Rebuilt rather than merged: a path the
      // project dropped has nothing left to supersede.
      const nextBaseline = settled.nextBaseline;
      const baselineChanged =
        Object.keys(nextBaseline).length !== Object.keys(baseline).length ||
        Object.entries(nextBaseline).some(
          ([folderPath, access]) => baseline[folderPath] !== access,
        );

      if (stateChanged || baselineChanged) {
        await setTaskState(dir, {
          ...(stateChanged && { attachedFolders: nextFolders }),
          projectFolderBaseline: nextBaseline,
        });
      }

      if (!instructionsChanged && !stateChanged) {
        return ok(undefined);
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
