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
  // Set when the user explicitly marked the task unread, distinguishing a hand
  // mark from an automatic completion mark. A manual mark clears only on a
  // genuine re-visit (leaving and returning), so viewing the task it was set
  // from does not clear it; an automatic mark clears as soon as it is viewed.
  manual: z.boolean().optional(),
});

export type TaskIndicator = z.output<typeof TaskIndicatorSchema>;
