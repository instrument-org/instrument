import { z } from "zod";

import { StoreId } from "./store-id";
import { ChatIdSchema } from "./chat-id";

const SessionTagSchema = z.enum([
  "agent.alive",
  "agent.done",
  "agent.paused",
  "agent.running",
  "agent.using-non-read-only-tools",
]);

export type SessionTag = z.output<typeof SessionTagSchema>;

export const ChatAgentStatusSchema = z.object({
  sessionActors: z.array(
    z.object({
      sessionId: StoreId.SessionSchema,
      tags: z.array(SessionTagSchema),
    }),
  ),
  chatId: ChatIdSchema,
});

export type ChatAgentStatus = z.output<typeof ChatAgentStatusSchema>;
