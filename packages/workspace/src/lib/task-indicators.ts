import { type TaskId } from "../schemas/task-id";
import { type TaskIndicatorKind } from "../schemas/task-indicator";
import { updateTaskSettings } from "./task-settings";

// Unread indicators live in each task's settings.json as `unreadIndicator` (see
// pins for the same pattern), so the state travels with the folder and is gone
// when the task is deleted. Consumers read it per task off the Task object
// (get-tasks populates it), so there is no aggregate getter here.

export function clearTaskIndicator(id: TaskId) {
  return updateTaskSettings(id, { unreadIndicator: null });
}

export function setTaskIndicator(id: TaskId, kind: TaskIndicatorKind) {
  return updateTaskSettings(id, { unreadIndicator: { kind } });
}
