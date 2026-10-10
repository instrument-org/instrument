import {
  AIGatewayModelURI,
  REASONING_EFFORTS,
} from "@instrument-org/ai-gateway";
import { z } from "zod";

import { ChatIdSchema } from "./chat-id";

/**
 * What a chat's settings say about it, read from its folder: its title,
 * when it was made and last worked in, and the apps, model and reasoning
 * effort its sessions run with.
 */
export const ChatInfoSchema = z.object({
  // The apps this chat may reach, by slug. Absent means every connected app;
  // empty means none. See ChatSettingsSchema, whose field this carries.
  apps: z.array(z.string()).optional(),
  createdAt: z.date(),
  id: ChatIdSchema,
  // The model the chat's sessions run on, absent until the composer first
  // sends with one. See ChatSettingsSchema.
  modelURI: AIGatewayModelURI.Schema.optional(),
  // The level chosen for this chat, absent when nobody chose one and the
  // model's own catalog default stands. See ChatSettingsSchema.
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  title: z.string(),
  updatedAt: z.date(),
});

export type ChatInfo = z.output<typeof ChatInfoSchema>;
