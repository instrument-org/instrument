import { z } from "zod";

import { type Task } from "./app";
import { StoreId } from "./store-id";

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
  task: z.custom<Task>(),
});

export type TaskAgentStatus = z.output<typeof TaskAgentStatusSchema>;
