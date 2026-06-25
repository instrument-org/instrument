import { z } from "zod";

import { ProjectIdSchema } from "./project-id";

// On-disk identity, in `projects/<Name>/.instrument/settings.json`. The folder
// name is the display name, so it is intentionally NOT stored here.
export const ProjectSettingsSchema = z.object({
  createdAt: z.coerce.date(),
  description: z.string().optional(),
  folders: z.array(z.string()).optional(),
  id: ProjectIdSchema,
});

export type ProjectSettings = z.output<typeof ProjectSettingsSchema>;

export const ProjectSchema = z.object({
  createdAt: z.date(),
  description: z.string(),
  folders: z.array(z.string()),
  id: ProjectIdSchema,
  instructions: z.string(),
  name: z.string(),
});

export type Project = z.output<typeof ProjectSchema>;
