import { type TaskId } from "../../schemas/task-id";
import { type BrowserHost } from "../../types";
import { taskDir } from "../task-dir-utils";
import { getTaskSettings } from "../task-settings";

/**
 * The window a task's browser opens in. A task of an orchestrator's browses in
 * the orchestrator's window, as one of its tabs, where the user can watch it
 * work; any other task's browser is the main window's, on its task page.
 */
export async function browserHostForTask(taskId: TaskId): Promise<BrowserHost> {
  const settings = await getTaskSettings(taskDir(taskId));
  if (settings?.kind === "orchestrator") {
    return "orchestrator";
  }
  const parentTaskId = settings?.parentTaskId;
  if (parentTaskId === undefined) {
    return "main";
  }
  const parent = await getTaskSettings(taskDir(parentTaskId));
  return parent?.kind === "orchestrator" ? "orchestrator" : "main";
}
