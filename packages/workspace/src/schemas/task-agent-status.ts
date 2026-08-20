import { z } from "zod";

import { StoreId } from "./store-id";
import { TaskIdSchema } from "./task-id";

const SessionTagSchema = z.enum([
  "agent.alive",
  "agent.done",
  "agent.paused",
  "agent.running",
  "agent.using-non-read-only-tools",
]);

export type SessionTag = z.output<typeof SessionTagSchema>;

export const TaskAgentStatusSchema = z.object({
  sessionActors: z.array(
    z.object({
      sessionId: StoreId.SessionSchema,
      tags: z.array(SessionTagSchema),
    }),
  ),
  taskId: TaskIdSchema,
});

export type TaskAgentStatus = z.output<typeof TaskAgentStatusSchema>;

export const TaskActivitySchema = TaskAgentStatusSchema.extend({
  activeReplaySessionIds: z.array(StoreId.SessionSchema),
});

export type TaskActivity = z.output<typeof TaskActivitySchema>;
