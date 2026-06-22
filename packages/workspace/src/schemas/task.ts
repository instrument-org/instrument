import { z } from "zod";

import { TaskIdSchema } from "./task-id";
import { TaskManifestSchema } from "./task-manifest";

// The loaded representation of a task: id + metadata read from disk. This is
// the "full thing" the client fetches when it needs more than an id.
export const TaskSchema = z.object({
  createdAt: z.date(),
  iconName: TaskManifestSchema.shape.iconName.optional(),
  id: TaskIdSchema,
  title: z.string(),
  updatedAt: z.date(),
});

export type Task = z.output<typeof TaskSchema>;
