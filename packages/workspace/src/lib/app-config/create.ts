import { type TaskId } from "../../schemas/task-id";

// Transitional shim: a task is now just its id. createAppConfig used to build a
// carrier object; it now returns the id directly so callers keep compiling
// until the id→id rename removes it entirely.
export function createAppConfig({ id }: { id: TaskId }): TaskId {
  return id;
}
