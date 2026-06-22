import { z } from "zod";

export const TaskSettingsSchema = z.object({
  createdWithAppVersion: z.string().optional(),
  name: z.string().default("Untitled task"),
});

export const TaskSettingsUpdateSchema = TaskSettingsSchema.partial().extend({
  name: z.string().trim().min(1).optional(),
});

export type TaskSettings = z.output<typeof TaskSettingsSchema>;
export type TaskSettingsUpdate = z.output<typeof TaskSettingsUpdateSchema>;
