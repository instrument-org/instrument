import {
  z,
} from "zod";

import {
  ProjectManifestSchema,
} from "./project-manifest";
import {
  TaskIdSchema,
} from "./task-id";

export const WorkspaceAppProjectSchema = z.object({
  createdAt: z.date(),
  description: ProjectManifestSchema.shape.description.optional(),
  folderName: z.string(),
  iconName: ProjectManifestSchema.shape.iconName.optional(),
  subdomain: TaskIdSchema,
  title: z.string(),
  type: z.literal("project"),
  updatedAt: z.date(),
  urls: z.object({
    assetBase: z.string(),
    localhost: z.string(),
    localRedirect: z.string(),
    loopback: z.string(),
  }),
});

// Previews were removed; a workspace app is always a project (task).
export const WorkspaceAppSchema = WorkspaceAppProjectSchema;

export type WorkspaceApp = z.output<typeof WorkspaceAppSchema>;
export type WorkspaceAppProject = z.output<typeof WorkspaceAppProjectSchema>;
