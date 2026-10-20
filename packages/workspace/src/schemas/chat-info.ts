import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { z } from "zod";

import { ChatIdSchema } from "./chat-id";

/**
 * What a chat's record says about it: its title (from its session's row),
 * when it was made and last worked in, and the model its sessions run on.
 */
export const ChatInfoSchema = z.object({
  createdAt: z.date(),
  id: ChatIdSchema,
  // The model the chat's sessions run on, absent until the composer first
  // sends with one. See chatModelURI.
  modelURI: AIGatewayModelURI.Schema.optional(),
  title: z.string(),
  updatedAt: z.date(),
});

export type ChatInfo = z.output<typeof ChatInfoSchema>;
