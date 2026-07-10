import { z } from "zod";

// Unread indicator kinds. Today only "completed" is produced -- it means the
// task finished and is unread, regardless of how it ended (success, stop, or
// error). "question" and "error" are reserved for surfacing those as distinct
// signals later without changing the persisted shape. The indicator is read
// per task off the Task object (Task.unreadIndicator).
const TaskIndicatorKindSchema = z.enum(["completed", "question", "error"]);

export type TaskIndicatorKind = z.output<typeof TaskIndicatorKindSchema>;

export const TaskIndicatorSchema = z.object({
  kind: TaskIndicatorKindSchema,
});
