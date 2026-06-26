import { ok, safeTry } from "neverthrow";
import nodePath from "node:path";
import { ulid } from "ulid";

import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { getEffectiveProjectContext } from "./effective-project-context";
import { getCurrentDate } from "./get-current-date";
import { getProject } from "./project";
import { Store } from "./store";
import { taskDir } from "./task-dir-utils";
import { getTaskState, setTaskState } from "./task-state-store";

/**
 * Compares the live project against the task's frozen project snapshot (folded
 * with any earlier changes) when a user message is sent, and reports drift in
 * instructions or attached folders. No watcher: a single read at send time.
 *
 * Folder additions/removals are applied to the task's attached folders here so
 * they become standing context; the returned `data-projectChanges` part is the
 * one-time announcement. Because instructions are read from the latest change
 * part and folders from task state, an already-reported change won't re-announce
 * on the next message. Returns undefined for non-project tasks, the first
 * message (snapshot not yet persisted), a deleted project, or no change.
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

      const liveFolderPaths = new Set(project.folders);
      const currentProjectPaths = new Set<string>(
        Object.values(attachedFolders)
          .filter((folder) => folder.source === "project")
          .map((folder) => folder.path),
      );

      const foldersRemoved: { name: string; path: string }[] = [];
      const nextFolders: Record<string, FolderAttachment.Type> = {};
      for (const [key, folder] of Object.entries(attachedFolders)) {
        if (folder.source === "project" && !liveFolderPaths.has(folder.path)) {
          foldersRemoved.push({ name: folder.name, path: folder.path });
          continue;
        }
        nextFolders[key] = folder;
      }

      const foldersAdded: { name: string; path: string }[] = [];
      for (const folderPath of project.folders) {
        if (currentProjectPaths.has(folderPath)) {
          continue;
        }
        const parsedPath = AbsolutePathSchema.safeParse(folderPath);
        if (!parsedPath.success) {
          continue;
        }
        const baseName = nodePath.basename(folderPath) || folderPath;
        const name = uniqueFolderName(baseName, nextFolders);
        nextFolders[name] = {
          createdAt: getCurrentDate().getTime(),
          id: FolderAttachment.IdSchema.parse(ulid()),
          name,
          path: parsedPath.data,
          source: "project",
        };
        foldersAdded.push({ name, path: folderPath });
      }

      if (
        !instructionsChanged &&
        foldersAdded.length === 0 &&
        foldersRemoved.length === 0
      ) {
        return ok(undefined);
      }

      if (foldersAdded.length > 0 || foldersRemoved.length > 0) {
        await setTaskState(dir, { attachedFolders: nextFolders });
      }

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

function uniqueFolderName(
  baseName: string,
  folders: Record<string, FolderAttachment.Type>,
): string {
  let candidate = baseName;
  let counter = 1;
  while (candidate in folders) {
    candidate = `${baseName}-${counter}`;
    counter++;
  }
  return candidate;
}
