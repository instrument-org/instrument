import { z } from "zod";

/**
 * What a task is for.
 *
 * A chat is the task the user talks to: it runs the `instrument` agent, never
 * does the work itself, and creates tasks to do it, each written as `task`
 * with the chat as its `parentTaskId`. The window's own record carries `chat`
 * too, as the record the chats' shared state lives on; it is told apart from a
 * chat by having no `chatSessionId`. A task a person made carries no kind at
 * all.
 */
export const TaskKindSchema = z.enum(["chat", "task"]);

export type TaskKind = z.output<typeof TaskKindSchema>;
