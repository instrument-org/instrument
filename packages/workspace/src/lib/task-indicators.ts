import { ResultAsync } from "neverthrow";

import { type TaskId } from "../schemas/task-id";
import {
  type TaskIndicator,
  type TaskIndicatorKind,
} from "../schemas/task-indicator";
import { taskDir } from "./task-dir-utils";
import { getTaskSettings, updateTaskSettings } from "./task-settings";

// Unread indicators live in each task's settings.json as `unreadIndicator` (see
// pins for the same pattern), so the state travels with the folder and is gone
// when the task is deleted. Consumers read it per task off the Task object
// (get-tasks populates it), so there is no aggregate getter here.

export function clearTaskIndicator(id: TaskId) {
  return updateTaskSettings(id, { unreadIndicator: null });
}

export function setTaskIndicator(
  id: TaskId,
  kind: TaskIndicatorKind,
  { manual = false }: { manual?: boolean } = {},
) {
  // Read-modify-write so stickiness only escalates: once the user marks a task
  // unread by hand, a later automatic completion mark must not downgrade it to
  // one that clears just by dwelling on the task.
  return ResultAsync.fromSafePromise(getTaskSettings(taskDir(id))).andThen(
    (settings) => {
      const nextManual = manual || Boolean(settings?.unreadIndicator?.manual);
      const indicator: TaskIndicator = nextManual
        ? { kind, manual: true }
        : { kind };
      return updateTaskSettings(id, { unreadIndicator: indicator });
    },
  );
}
