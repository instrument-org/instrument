import { REASONING_EFFORTS } from "@instrument-org/ai-gateway";
import { z } from "zod";

import { TaskIdSchema } from "./task-id";

// The loaded representation of a task: id + metadata read from disk. This is
// the "full thing" the client fetches when it needs more than an id.
export const TaskSchema = z.object({
  // The apps this task may reach, by slug. Absent means every connected app,
  // which is what a task a person made gets; empty means none. See
  // TaskSettingsSchema, whose field this carries.
  apps: z.array(z.string()).optional(),
  createdAt: z.date(),
  id: TaskIdSchema,
  // Whether the record is a chat's own, which its folder being under
  // `chats/` says.
  isChat: z.boolean(),
  // The chat whose `tasks/` folder holds this task; absent for a chat, and
  // for a task no chat owns.
  parentTaskId: TaskIdSchema.optional(),
  // The level chosen for this task, absent when nobody chose one and the
  // model's own catalog default stands. See TaskSettingsSchema.
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  title: z.string(),
  updatedAt: z.date(),
});

export type Task = z.output<typeof TaskSchema>;
