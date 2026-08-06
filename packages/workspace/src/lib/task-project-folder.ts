import { type TaskId } from "../schemas/task-id";
import { resolveProjectFolder } from "./project";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings } from "./task-settings";
import { getTaskState, setTaskState } from "./task-state-store";

/**
 * The folder under `projects/` this task's project lives in, or undefined when
 * it has no project.
 *
 * Derived on demand from the task's live `projectId` rather than maintained as
 * state, so there is nothing to keep in step: a task added to a project resolves
 * to the new folder on the next call, one removed from a project resolves to
 * nothing, and a project folder renamed behind the app's back is picked up the
 * same way. The alternative -- writing the answer whenever a task's project
 * changes -- has to be remembered at every site that changes one, and silently
 * mounts the wrong folder wherever it is forgotten.
 *
 * `projectFolderName` in task state is only a hint, so the usual call is one
 * read of the project's settings to confirm it rather than a scan of every
 * project. A wrong or missing hint costs the scan and is corrected for next
 * time; nothing depends on it being right.
 */
export async function resolveTaskProjectFolder(
  taskId: TaskId,
): Promise<string | undefined> {
  const dir = taskDir(taskId);
  const settings = await getTaskSettings(dir);
  if (!settings?.projectId) {
    return undefined;
  }

  const state = await getTaskState(dir);
  const hint = state.projectFolderName;
  const folder = await resolveProjectFolder(settings.projectId, { hint });

  // Only on a miss, which is the rare path: a rename, or the first resolve for
  // a task that just joined a project. Best-effort, because a failed write costs
  // the next call a scan and nothing else.
  if (folder && folder !== hint) {
    await setTaskState(dir, { projectFolderName: folder }).catch(() => {
      return;
    });
  }

  return folder;
}
