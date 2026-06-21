import { z } from "zod";

import { ProjectManifestSchema } from "./project-manifest";
import { TaskIdSchema } from "./task-id";

// The loaded representation of a task: id + metadata read from disk. This is
// the "full thing" the client fetches when it needs more than an id.
export const TaskSchema = z.object({
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

export type Task = z.output<typeof TaskSchema>;
