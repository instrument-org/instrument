import { z } from "zod";

export const TaskManifestSchema = z.object({
  createdWithAppVersion: z.string().optional(),
  name: z.string().default("Untitled task"),
});

export const TaskManifestUpdateSchema = TaskManifestSchema.partial().extend({
  name: z.string().trim().min(1).optional(),
});

export type TaskManifest = z.output<typeof TaskManifestSchema>;
export type TaskManifestUpdate = z.output<typeof TaskManifestUpdateSchema>;
