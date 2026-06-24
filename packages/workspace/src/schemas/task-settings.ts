import { z } from "zod";

import { ProjectIdSchema } from "./project-id";

export const TaskSettingsSchema = z.object({
  createdWithAppVersion: z.string().optional(),
  name: z.string().default("Untitled task"),
  // The project this task belongs to, if any.
  projectId: ProjectIdSchema.optional(),
});

export const TaskSettingsUpdateSchema = TaskSettingsSchema.partial().extend({
  name: z.string().trim().min(1).optional(),
  // `null` explicitly clears the project association; omit to leave unchanged.
  projectId: ProjectIdSchema.nullable().optional(),
});

export type TaskSettings = z.output<typeof TaskSettingsSchema>;
export type TaskSettingsUpdate = z.output<typeof TaskSettingsUpdateSchema>;
