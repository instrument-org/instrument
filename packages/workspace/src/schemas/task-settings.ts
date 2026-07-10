import { z } from "zod";

import { ProjectIdSchema } from "./project-id";
import { TaskIndicatorSchema } from "./task-indicator";

export const TaskSettingsSchema = z.object({
  createdWithAppVersion: z.string().optional(),
  name: z.string().default("Untitled task"),
  // Presence marks the task as pinned; the timestamp orders the pin list. Lives
  // in the folder so it travels with a rename and can't collide with a reused
  // folder name.
  pinnedAt: z.coerce.date().optional(),
  projectId: ProjectIdSchema.optional(),
  // Presence marks the task as unread. Lives in the folder for the same reasons
  // as pinnedAt, so listing unread tasks is just a scan of task settings.
  unreadIndicator: TaskIndicatorSchema.optional(),
});

export const TaskSettingsUpdateSchema = TaskSettingsSchema.partial().extend({
  name: z.string().trim().min(1).optional(),
  // `null` explicitly clears (unpins); omit to leave unchanged.
  pinnedAt: z.coerce.date().nullable().optional(),
  // `null` explicitly clears the project association; omit to leave unchanged.
  projectId: ProjectIdSchema.nullable().optional(),
  // `null` explicitly clears the unread indicator (marks read); omit to leave
  // unchanged.
  unreadIndicator: TaskIndicatorSchema.nullable().optional(),
});

export type TaskSettings = z.output<typeof TaskSettingsSchema>;
export type TaskSettingsUpdate = z.output<typeof TaskSettingsUpdateSchema>;
