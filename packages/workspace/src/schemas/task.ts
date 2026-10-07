import { REASONING_EFFORTS } from "@instrument-org/ai-gateway";
import { z } from "zod";

import { ChatIdSchema } from "./chat-id";
import { TaskIdSchema } from "./task-id";

const TaskFieldsSchema = z.object({
  // The apps this task may reach, by slug. Absent means every connected app,
  // which is what a task a person made gets; empty means none. See
  // TaskSettingsSchema, whose field this carries.
  apps: z.array(z.string()).optional(),
  createdAt: z.date(),
  id: TaskIdSchema,
  // The level chosen for this task, absent when nobody chose one and the
  // model's own catalog default stands. See TaskSettingsSchema.
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  title: z.string(),
  updatedAt: z.date(),
});

// The loaded representation of a record: id + metadata read from disk, either
// a chat's own (its folder under `chats/`) or a task inside the chat whose
// `tasks/` folder holds it. This is the "full thing" the client fetches when
// it needs more than an id.
export const ChatRecordSchema = TaskFieldsSchema.extend({
  isChat: z.literal(true),
});

/** A task, with the chat whose `tasks/` folder holds it. */
export const TaskInChatSchema = TaskFieldsSchema.extend({
  chatId: ChatIdSchema,
  isChat: z.literal(false),
});

export const TaskSchema = z.discriminatedUnion("isChat", [
  ChatRecordSchema,
  TaskInChatSchema,
]);

export type Task = z.output<typeof TaskSchema>;

export type TaskInChat = z.output<typeof TaskInChatSchema>;
