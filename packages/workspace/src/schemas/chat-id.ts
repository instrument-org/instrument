import { type z } from "zod";

import { TaskIdSchema } from "./task-id";

/**
 * A chat's id: the name of its folder under `chats/`. A chat is a record like
 * a task, so a chat id goes wherever any record's id does (its store, its
 * folder, its session machine), but a task's id is never a chat's: what takes
 * a `ChatId` is answering for a chat, and gets one from `resolveRecord` or
 * from the chat that made it.
 */
export const ChatIdSchema = TaskIdSchema.brand("ChatId");
export type ChatId = z.output<typeof ChatIdSchema>;
