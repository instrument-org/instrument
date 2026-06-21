import { type TaskId, TaskIdSchema } from "../schemas/task-id";

export function isProjectSubdomain(subdomain: string): subdomain is TaskId {
  return TaskIdSchema.safeParse(subdomain).success;
}
