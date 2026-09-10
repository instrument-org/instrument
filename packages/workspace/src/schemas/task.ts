import { REASONING_EFFORTS } from "@instrument-org/ai-gateway";
import { z } from "zod";

import { ProjectIdSchema } from "./project-id";
import { TaskIdSchema } from "./task-id";
import { TaskIndicatorSchema } from "./task-indicator";
import { TaskKindSchema } from "./task-kind";

// The loaded representation of a task: id + metadata read from disk. This is
// the "full thing" the client fetches when it needs more than an id.
export const TaskSchema = z.object({
  // The apps this task may reach, by slug. Absent means every connected app,
  // which is what a task a person made gets; empty means none. See
  // TaskSettingsSchema, whose field this carries.
  apps: z.array(z.string()).optional(),
  createdAt: z.date(),
  id: TaskIdSchema,
  kind: TaskKindSchema.optional(),
  parentTaskId: TaskIdSchema.optional(),
  // The level chosen for this task, absent when nobody chose one and the
  // model's own catalog default stands. See TaskSettingsSchema.
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  // Set when the task is pinned; the timestamp is when it was pinned.
  pinnedAt: z.date().optional(),
  projectId: ProjectIdSchema.optional(),
  title: z.string(),
  // Set when the task is unread (agent finished, or user marked it unread).
  unreadIndicator: TaskIndicatorSchema.optional(),
  updatedAt: z.date(),
});

export type Task = z.output<typeof TaskSchema>;
