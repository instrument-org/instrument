import { type TaskId, TaskIdSchema } from "../schemas/task-id";

export function isTaskId(id: string): id is TaskId {
  return TaskIdSchema.safeParse(id).success;
}
