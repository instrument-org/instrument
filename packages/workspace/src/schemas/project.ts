import { z } from "zod";

import { FolderAttachment } from "./folder-attachment";
import { ProjectIdSchema } from "./project-id";

export const ProjectFolderSchema = z.object({
  access: FolderAttachment.AccessSchema,
  path: z.string(),
});

export type ProjectFolder = z.output<typeof ProjectFolderSchema>;

// A bare path is how folders were stored before access was a choice, and it
// still reads as read-only. Only the on-disk shape is tolerant of it: anything
// written from here on is the object form, and an RPC caller has no legacy to
// carry.
const StoredProjectFolderSchema = z
  .union([z.string(), ProjectFolderSchema])
  .transform((folder) =>
    typeof folder === "string"
      ? { access: "read-only" as const, path: folder }
      : folder,
  );

// On-disk identity, in `projects/<Name>/.instrument/settings.json`. The folder
// name is the display name, so it is intentionally NOT stored here.
export const ProjectSettingsSchema = z.object({
  createdAt: z.coerce.date(),
  description: z.string().optional(),
  folders: z.array(StoredProjectFolderSchema).optional(),
  id: ProjectIdSchema,
});

export type ProjectSettings = z.output<typeof ProjectSettingsSchema>;

export const ProjectSchema = z.object({
  createdAt: z.date(),
  description: z.string(),
  folders: z.array(ProjectFolderSchema),
  id: ProjectIdSchema,
  instructions: z.string(),
  name: z.string(),
});

export type Project = z.output<typeof ProjectSchema>;
