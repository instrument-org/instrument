import { z } from "zod";

import { ProjectIdSchema } from "./project-id";
import { TaskIndicatorSchema } from "./task-indicator";

export const TaskSettingsSchema = z.object({
  // When the task was made, recorded for the same reason as `lastActivityAt`:
  // the observable answer is the session database's birth time, which is when
  // the task was first opened, and for a branched or imported task it is when
  // the copy happened.
  createdAt: z.coerce.date().optional(),
  createdWithAppVersion: z.string().optional(),
  // When something happened in this task, as opposed to when a file under it
  // was last written. It orders the task list, and it is recorded rather than
  // observed because the observable timestamps do not mean what the list needs:
  // the session database is rewritten by the act of opening a task, so sorting
  // on its mtime moves a task to the top for having been read.
  lastActivityAt: z.coerce.date().optional(),
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
  lastActivityAt: z.coerce.date().optional(),
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
